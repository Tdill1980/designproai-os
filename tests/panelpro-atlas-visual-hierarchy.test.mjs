/**
 * THE A.T.L.A.S. MASTER IS THE TOP OF THE PANELPRO WORKSPACE.
 *
 * Owner, 2026-08-31: "In PanelProStudio, the canonical A.T.L.A.S. master must be
 * visible at the TOP of the job workspace immediately after Call 1 persistence
 * succeeds... Do NOT bury A.T.L.A.S. inside version history, a secondary card, a
 * modal, or a production section... Treat absence of A.T.L.A.S. in
 * PanelProStudio as DCA failure."
 *
 * And the reason this file exists at all, in the owner's words: "the tests appear
 * to be checking hydration, panel maps, and lineage mechanics, but not the actual
 * visual hierarchy you require. That is why code can be 'green' while the most
 * important artifact is missing from the UI."
 *
 * So these assertions are deliberately about ORDER and PRESENCE in the rendered
 * tree, not about data plumbing -- the plumbing is already locked elsewhere and
 * was green throughout the period the master was missing from the screen.
 *
 * Required order:
 *   GenerationID / DesignID / RevisionID / Version
 *     -> A.T.L.A.S. MASTER
 *       -> six canonical Call-1 panels
 *         -> progressive 3D proofs
 *           -> later Call 8 / Call 9 / QC descendants
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const board = readFileSync(new URL("../app/src/pages/AdminGeminiCompareStudio.tsx", import.meta.url), "utf8");
const source = readFileSync(new URL("../app/src/lib/panelpro-studio-source.ts", import.meta.url), "utf8");

/** Index of a marker, asserted to exist so an ordering test cannot pass on -1. */
function at(haystack, needle, label) {
  const index = haystack.indexOf(needle);
  assert.notEqual(index, -1, `${label}: expected to find ${JSON.stringify(needle)}`);
  return index;
}

test("the identity block names the generation, design AND revision", () => {
  const generationId = at(board, "Generation ID", "generation id label");
  const designId = at(board, '["Design ID"', "design id row");
  const revisionId = at(board, '["Revision ID"', "revision id row");
  const version = at(board, '["Current A.T.L.A.S. version"', "atlas version row");

  assert.ok(
    generationId < designId,
    "the GenerationID must lead the identity block -- it is the id every artifact carries",
  );
  // Revision is identity, not a footnote: a panel and a proof are only
  // comparable within one immutable revision.
  assert.ok(revisionId > designId, "Revision ID belongs with Design ID in the identity block");
  assert.ok(version > designId, "the A.T.L.A.S. version belongs in the identity block");
});

test("the A.T.L.A.S. master renders above the per-surface work area", () => {
  const identity = at(board, "Generation ID", "identity block");
  const atlasCard = at(board, "<AtlasProgressCard", "atlas card mount");
  const versionHistory = at(board, "Version + prompt history", "version history section");
  const surfaceRows = at(board, "<SurfacePairRows", "per-surface proof/panel rows");

  assert.ok(
    identity < atlasCard,
    "identity first, then the master -- the master must be attributable on sight",
  );
  assert.ok(
    atlasCard < versionHistory,
    "the master must NOT be buried inside version history",
  );
  assert.ok(
    atlasCard < surfaceRows,
    "the master must sit above the proof/panel work area, not below it",
  );
});

test("the master is rendered as an image, not merely described", () => {
  const card = board.slice(at(board, "function AtlasProgressCard", "atlas card"), at(board, "function SurfacePairRows", "surface rows fn"));
  assert.match(card, /<img[\s\S]{0,400}?src=\{atlas\.masterUrl\}/,
    "the board must render the master sheet itself");
  assert.match(card, /data-testid="atlas-master"/,
    "the master container must be addressable for acceptance checks");
  assert.match(card, /Download master/, "the master must be downloadable");
});

test("a missing A.T.L.A.S. master is stated, never silent", () => {
  const card = board.slice(at(board, "function AtlasProgressCard", "atlas card"), at(board, "function SurfacePairRows", "surface rows fn"));
  assert.match(card, /\{!atlas\?\.masterUrl && \(/,
    "absence must render an explicit state, not nothing at all");
  assert.match(card, /data-testid="atlas-master-missing"/,
    "the missing state must be addressable so a DCA can fail on it");
  assert.match(card, /A\.T\.L\.A\.S\. master not available/,
    "the missing state must say what is missing in plain words");
});

test("no proof or panel image may substitute for the master", () => {
  const card = board.slice(at(board, "function AtlasProgressCard", "atlas card"), at(board, "function SurfacePairRows", "surface rows fn"));
  // The master slot binds to atlas.masterUrl and nothing else. A fallback to a
  // proof render would make an absent master invisible again, which is the
  // whole failure this file exists to catch.
  assert.doesNotMatch(card, /src=\{atlas\?\.masterUrl \|\|/,
    "the master image must not fall back to another source");
  assert.doesNotMatch(card, /masterUrl \|\| proofUrls/,
    "a proof must never stand in for the master");
});

test("the loader hydrates the A.T.L.A.S. revisions the master comes from", () => {
  // Presence in the UI is only possible if the job carries the revisions. This
  // is the one plumbing assertion here, because the hierarchy above is
  // unsatisfiable without it.
  assert.match(source, /listJobFlatAtlasRevisions/,
    "loadPanelProStudioJob must read the A.T.L.A.S. revisions");
  assert.match(source, /atlas_versions/,
    "the projected job must expose the A.T.L.A.S. revisions to the board");
});
