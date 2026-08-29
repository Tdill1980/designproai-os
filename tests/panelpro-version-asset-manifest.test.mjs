// THE DESIGN TEAM HAS TO BE ABLE TO TAKE THE FILES OFF THE BOARD. (Trish 2026-08-28)
//
// "The design team must be able to download all assets and files, so make card
// containers downloadable, also all metadata must be present and version
// history all in UI."
//
// RULE 0.22 already required it -- the complete asset set, "each individually
// downloadable", and "do not hide files behind only a final ZIP". The board
// downloaded the master, the logos, the per-surface print files and the
// stamp/ZIP. Three things it did not, and they are the three a designer needs
// to validate a panel against a real vehicle:
//
//   the six Call-1 PANELS as files, with trim/print/bleed/sq ft/PPI beside them
//   the seven 3D PROOFS, which were display-only
//   the 2D Production Proof
//
// These assertions are about the CONTRACT, not the styling: which artifacts the
// card offers, that each carries its record, that it binds to the selected
// version rather than the newest, and that a missing artifact is reported
// missing rather than substituted.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const manifest = readFileSync(
  new URL("../app/src/components/designpro/VersionAssetManifest.tsx", import.meta.url),
  "utf8",
);
const board = readFileSync(
  new URL("../app/src/pages/AdminGeminiCompareStudio.tsx", import.meta.url),
  "utf8",
);

test("the control room mounts the asset manifest against the SELECTED version", () => {
  assert.match(board, /import \{ VersionAssetManifest \} from "@\/components\/designpro\/VersionAssetManifest";/);
  // `atlas` in that card is resolved from selectedVersion, falling back to the
  // newest -- so passing it is what keeps V1 reachable after V2 exists.
  assert.match(board, /<VersionAssetManifest job=\{job\} atlas=\{atlas\} \/>/);
});

test("every downloadable artifact class is offered", () => {
  for (const section of [
    "Master sheet",
    "Authoring guide",
    "Print panels",
    "3D proofs",
    "2D Production Proof",
  ]) {
    assert.ok(manifest.includes(section), `${section} must be offered on the card`);
  }
  // All seven cameras, by their real source view types.
  for (const camera of [
    "side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof",
  ]) {
    assert.ok(manifest.includes(`"${camera}"`), `${camera} must have a row`);
  }
});

test("a download link carries a real filename, because the bare attribute is ignored cross-origin", () => {
  // Supabase honours ?download=<name>; without it the file opens in a tab or
  // saves under its content hash.
  assert.ok(manifest.includes("download=${encodeURIComponent(name)}"));
  assert.match(manifest, /withDownloadName\(href, filename\)/);
});

test("every panel row states the dimensions that make it checkable", () => {
  for (const field of [
    "trimWidthIn", "trimHeightIn", "printWidthIn", "printHeightIn",
    "bleedInches", "surfaceSqFt", "effectivePpi", "pixelWidth", "pixelHeight",
  ]) {
    assert.ok(manifest.includes(field), `panel rows must show ${field}`);
  }
  // And where it came from, so a file taken off the card stays traceable.
  assert.ok(manifest.includes("sourceMasterHash"));
});

test("every proof row states the panel it was rendered from", () => {
  assert.ok(manifest.includes("atlasBinding"));
  assert.ok(manifest.includes("zoneSurfaceKey"));
  assert.ok(manifest.includes("zoneContentHash"));
});

test("a missing artifact is reported missing, never substituted", () => {
  // RULE 0.27 §3: neither UI may synthesize its own representation of a missing
  // canonical artifact.
  assert.match(manifest, /not produced yet/);
  assert.doesNotMatch(manifest, /placeholder|fallbackUrl|\|\| ".*\.png"/);
});

// ────────────────────────────────────────────────────────────────────────────
// THE PAIR IS THE CONTAINER, AND IT DOES NOT COLLAPSE. (Trish 2026-08-28)
//
// "RevisionStudioIQ must have containers on right side column with print panel
// next to 3d proofs — you already had this working!"
//
// It was working, and it still is — but the row collapsed to ONE wide tile
// whenever either half was missing, so a board whose roof proof had not
// rendered read as though the layout itself had broken. Live 2026-08-26,
// generation 04cc0b29: five of seven views existed, roof was never rendered,
// and its row showed a lone panel with nothing saying why.
const layers = readFileSync(
  new URL("../app/src/components/revisioniq/ProductionFlowLayersCard.tsx", import.meta.url),
  "utf8",
);

test("the proof-beside-panel row never collapses to one column", () => {
  assert.match(layers, /const cols = "grid-cols-2";/);
  assert.doesNotMatch(
    layers,
    /panelUrl && showApproved \? "grid-cols-2" : "grid-cols-1"/,
    "a missing half must not silently widen the other half",
  );
});

test("an absent half is labeled, not blank and not substituted", () => {
  assert.match(layers, /function MissingHalf\(/);
  assert.match(layers, /3D proof not rendered yet/);
  assert.match(layers, /Print panel not cut yet/);
});

test("proof stays LEFT and panel stays RIGHT", () => {
  // RULE 0.21 in its own words. The customer approved the design on the
  // vehicle; the panel is what that approval produced.
  const proofAt = layers.indexOf("Your approved design");
  const panelAt = layers.indexOf("label={panelLabel}");
  assert.ok(proofAt > 0 && panelAt > 0 && proofAt < panelAt, "the proof column must come first");
});

// ────────────────────────────────────────────────────────────────────────────
// THE PRESENCE SWEEP THE DESIGN TEAM TICKS. (Trish 2026-08-28)
//
// "All the checks must be visible in UI on PanelProStudio ... it was just
// missing the written checkboxes for QC the design team needs to use", followed
// by the eleven items themselves.
//
// PREFLIGHT_CHECKS asks whether the pack is CORRECT. This asks the question
// that comes first and had no written form: is every artifact actually there.
// Each row shows evidence the board computes from the run's own artifacts, and
// the box beside it is only ever ticked by a person -- RULE 0.22, PanelPro QC
// is human design-team QC.
const stages = readFileSync(
  new URL("../app/src/lib/designpro-stages.ts", import.meta.url),
  "utf8",
);

test("every item the owner listed has a written checkbox", () => {
  for (const key of [
    "atlasPresent", "designIdPresent", "sevenProofsPresent",
    "proofsIndividuallyPresent", "resolutionPresent", "dimensionsPresent",
    "panelQtyPresent", "assetsSeparate", "tiffPresent", "pngPresent",
    "productionProofPresent",
  ]) {
    assert.ok(stages.includes(`"${key}"`), `${key} must be a written check`);
  }
  assert.match(board, /PACK_PRESENCE_CHECKS\.map\(\(\[key, label\]\) => \(/);
});

test("the sweep gates the preflight release, it is not decorative", () => {
  assert.match(board, /PACK_PRESENCE_CHECKS\.every\(\(\[key\]\) => preflight\[key\]\)/);
  // And it travels into the receipt the QC certificate is written from.
  assert.match(board, /PACK_PRESENCE_CHECKS\.reduce\(/);
});

test("evidence is computed from artifacts, and the box is still human", () => {
  assert.match(board, /function packPresenceEvidence\(/);
  // Real counts, not assertions: cameras rendered, panels cut, formats present.
  for (const source of ["job.raw_views", "callOnePanels", "job.outputs", "job.logos"]) {
    assert.ok(board.includes(source), `evidence must read ${source}`);
  }
  // Nothing pre-ticks a box.
  assert.doesNotMatch(board, /checked=\{true\}/);
});

// ────────────────────────────────────────────────────────────────────────────
// THE BOARD SHOWS THE PAIR, AND THE ZIP SAYS WHAT IS IN IT. (Trish 2026-08-28)
//
// Three asks, one screen:
//
//   "ATLAS design with visible Generation ID should be at top of the
//    PanelProStudio admin page, then panels next to individual 3d proofs,
//    then production sheet"
//   "All ZIP assets must have a container next to ZIP so we know what's in ZIP"
//   "I need the actual ATLAS Generation ID # viewable"  (RevisionStudioIQ)
//
// The per-side row existed only at /panelpro/surfaces, one level below the
// control room, so the board went master → logos and skipped the pair a
// designer actually validates. The ZIP had a download link and a census of
// kinds; a census cannot say WHICH six panels or at what path. And
// RevisionStudio printed the eight-character DID, which recognises a job but
// cannot be pasted into PanelPro, a query or a support thread.

test("the pair rows sit between the master and the production pack", () => {
  assert.match(board, /function SurfacePairRows\(/);
  assert.match(board, /Real design proof ∥ print panel · per surface/);
  const pairAt = board.indexOf("<SurfacePairRows job=");
  const masterAt = board.indexOf("<VersionAssetManifest job={job} atlas={atlas} />");
  const packAt = board.indexOf("<ProductionPackSection");
  assert.ok(masterAt > 0 && pairAt > 0 && packAt > 0);
  assert.ok(pairAt < packAt, "panels beside their proofs must come before the production sheet");
});

test("a missing half of the pair is reported, never substituted", () => {
  assert.match(board, /3D proof not rendered yet/);
  assert.match(board, /Print panel not cut yet/);
  // RULE 0.21: the board publishes the server's artifacts, it does not make them.
  const rows = board.slice(board.indexOf("function SurfacePairRows("), board.indexOf("function SurfacePairRows(") + 5200);
  for (const producer of ["Pull panel", "Mirror from driver"]) {
    assert.equal(rows.includes(producer), false, `${producer} is a browser-era producer`);
  }
});

test("the pair states whether both halves came from the same master", () => {
  assert.match(board, /same master/);
  assert.match(board, /different masters/);
  assert.match(board, /side\?\.atlas\?\.matches/);
});

test("the ZIP publishes a per-file manifest, not only a count of kinds", () => {
  const claimant = readFileSync(
    new URL("../runtime/designpro-standalone-claimant.cjs", import.meta.url), "utf8",
  );
  assert.match(claimant, /const archiveManifest = \[/);
  for (const field of ["archivePath", "kind", "surfaceKey", "contentHash", "byteSize"]) {
    assert.ok(claimant.includes(field), `every archive row must carry ${field}`);
  }
  // Every entry written is an entry listed, or the stage refuses.
  assert.match(claimant, /zip_manifest_incomplete/);
  assert.match(claimant, /includedKinds, archiveManifest,/);
});

test("the board renders that manifest beside the ZIP", () => {
  assert.match(board, /function ZipContentsCard\(/);
  assert.match(board, /Inside the Production ZIP/);
  assert.match(board, /<ZipContentsCard zip=\{job\.zip\} \/>/);
  // Before the archive exists it says so rather than previewing a contract.
  assert.match(board, /No archive built yet/);
});

test("RevisionStudio shows the full Generation ID, not only the DID", () => {
  const studio = readFileSync(
    new URL("../app/src/pages/RevisionStudioIQ.tsx", import.meta.url), "utf8",
  );
  assert.match(studio, /A\.T\.L\.A\.S\. Generation ID — click to copy/);
  assert.match(studio, /Generation ID copied/);
  // And the DID badge stays: the two answer different questions.
  assert.match(studio, /formatDid\(genIdOf\(selectedRender\) \|\| selectedRender\?\.id\)/);
});
