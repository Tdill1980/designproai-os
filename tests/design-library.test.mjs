import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20260826040000_designpro_generation_library.sql", import.meta.url),
  "utf8",
);
const gateway = readFileSync(new URL("../gateway/src/server.mjs", import.meta.url), "utf8");
const api = readFileSync(new URL("../app/src/lib/designpro-api.ts", import.meta.url), "utf8");
const library = readFileSync(
  new URL("../app/src/components/revisioniq/DesignLibrary.tsx", import.meta.url),
  "utf8",
);
const studio = readFileSync(
  new URL("../app/src/pages/RevisionStudioIQ.tsx", import.meta.url),
  "utf8",
);

/**
 * THE LIBRARY READS THE GENERATION RECORDS, NOT THE WORKFLOW RUNS.
 *
 * A run is created by the production handoff. Measured over the last four
 * months: 48 real DesignPro generations, 8 of which have a run. Keying the
 * studio's feed on runs is what made 40 recent designs -- everything still in
 * Calls 1-7 and everything that failed there -- unreachable from the studio
 * built to revise them.
 */
test("the library reads designpro_generation_requests, in one table", () => {
  assert.match(migration, /FROM public\.designpro_generation_requests r/);
  assert.match(migration, /ORDER BY r\.created_at DESC/);
  // ONE table. A union is how a curated old row takes the slot a recent one
  // needed, and there is nothing here to curate.
  for (const forbidden of [
    "color_visualizations", "designiq_generations", "production_flow_assets",
    "panelizer_jobs", "vehicle_renders", "UNION",
  ]) {
    assert.ok(!migration.includes(forbidden), `the library must not read ${forbidden}`);
  }
});

test("four months is the default window, and the window is not a page size", () => {
  assert.match(migration, /now\(\) - interval '4 months'/);
  assert.match(migration, /r\.created_at >= v_since/);
  // The cap sits far above the volume the window selects, so it can never be
  // the thing that decides what a designer can see.
  assert.match(migration, /LEAST\(GREATEST\(COALESCE\(p_limit, 500\), 1\), 1000\)/);
  // The client leaves `since` to the server by default, so the window is
  // defined once rather than in every caller.
  assert.match(gateway, /p_since: since/);
  assert.match(gateway, /Null lets the database apply its own four-month default/);
});

/** Every column the product promises, from the record itself. */
test("a library row carries what a designer needs to identify the job", () => {
  for (const field of [
    '"generationId"', '"designName"', '"companyName"', "vehicle", "state",
    "pipeline", '"revisionCount"', '"currentRevision"', '"masterContentHash"',
    '"thumbnailStoragePath"', "production",
  ]) {
    assert.ok(migration.includes(field), `the library row must publish ${field}`);
  }
  // A.T.L.A.S. or Standard is decided by what the request asked for, not by
  // what it happens to have produced so far.
  assert.match(migration, /THEN 'atlas' ELSE 'standard'\s*\n\s*END AS pipeline/);
  // The Design ID comes from the one canonical helper, so the library labels a
  // design exactly as the studio and the board do.
  assert.match(gateway, /designId: canonicalDesignId\(generationId\)/);
  assert.match(api, /export type DesignLibraryEntry/);
  assert.match(api, /listDesignLibrary:/);
});

/**
 * A DESIGN WITH NOTHING TO SHOW IS STILL IN THE LIBRARY. Sixteen of those 48
 * produced no image at all, and they are the ones a designer most needs to
 * find. The old grid dropped every row without an image.
 */
test("a design with no image is published, not filtered out", () => {
  // No image-presence filter anywhere in the query.
  assert.ok(!migration.includes("thumbnailStoragePath IS NOT NULL"));
  // The gateway publishes the row with no URL rather than omitting it.
  assert.match(gateway, /A design with no image is published without one/);
  assert.match(gateway, /\.\.\.\(thumbnailUrl \? \{ thumbnailUrl, expiresIn: 300 \} : \{\}\)/);
  // And the card says which of the two reasons it is.
  assert.match(library, /This design produced no image/);
  assert.match(library, /Still rendering/);
  assert.match(library, /Proofs withheld/);
});

/**
 * One fence, both surfaces. A superseded proof set is withheld in the
 * workspace, so it must not be used as a library thumbnail either -- or a
 * design looks current in the library and is refused inside it.
 */
test("a superseded proof set is not used as a preview", () => {
  assert.match(migration, /AND NOT designpro_private\.flat_first_atlas_requires_new_run\(r\.id\)/);
  assert.match(migration, /a\.master_storage_path/, "the master is the fallback tile");
});

test("the tile is signed only inside the design's own prefix, and paths never leave", () => {
  assert.match(gateway, /authorizedGenerationViewPath\(storagePath, ownerId, generationId\)/);
  assert.match(gateway, /authorizedFlatAtlasPath\(storagePath, ownerId, generationId\)/);
  // The row is rebuilt field by field, so a storage path cannot ride along.
  assert.ok(!gateway.includes("...row,"), "the library must not spread the raw row");
});

/** Design staff see the shop's work; a customer sees their own. */
test("the library authorizes on the existing QC membership", () => {
  assert.match(migration, /v_staff := designpro_private\.caller_is_design_staff\(\)/);
  assert.match(migration, /\(v_staff OR r\.owner_id=v_owner\)/);
  assert.match(migration, /RAISE EXCEPTION 'authentication_required'/);
});

/** Search and filter over what a person actually has in hand. */
test("the library filters by name, id, vehicle, pipeline and status", () => {
  assert.match(library, /export function matchesQuery/);
  for (const field of [
    "entry.companyName", "entry.designName", "entry.generationId", "entry.designId",
    "entry.vehicle?.make", "entry.vehicle?.model",
  ]) {
    assert.ok(library.includes(field), `search must cover ${field}`);
  }
  assert.match(library, /export function statusOf/);
  // Production wins over completed: it is the later fact about one design.
  assert.match(library, /if \(entry\.production\) return "production"/);
  assert.match(library, /entry\.pipeline !== pipeline\) return false/);
  assert.match(library, /statusOf\(entry\) !== status\) return false/);
});

/** Browse, then open — in the studio, and through to PanelPro. */
test("the library opens a design in the studio and in PanelPro", () => {
  assert.match(library, /\/designpro\/jobs\/\$\{encodeURIComponent\(entry\.generationId\)\}\/panelpro/);
  assert.match(library, /onOpen\?\.\(entry\.generationId\)/);
  assert.match(studio, /<DesignLibrary onOpen=\{openDesignById\} \/>/);
  // Opening resolves against the server when the feed cannot answer, which is
  // most of the library.
  assert.match(studio, /readRevisionStudioDesign\(id\)/);
});

/** Not a producer. Browsing changes nothing. */
test("the library generates nothing", () => {
  for (const producer of [
    "supabase.from", "functions.invoke", "Pull panel", "Mirror from driver",
    "regenerate", "submitRevision",
  ]) {
    assert.ok(!library.includes(producer), `the library must not carry ${producer}`);
  }
});
