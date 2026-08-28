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
