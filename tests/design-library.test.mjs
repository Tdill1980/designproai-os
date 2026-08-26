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
const source = readFileSync(
  new URL("../app/src/lib/revisionstudio-source.ts", import.meta.url),
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
    "pipeline", '"revisionCount"', '"currentRevision"',
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
  assert.match(gateway, /published without a tile/);
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
});

/**
 * ⛔ THE A.T.L.A.S. MASTER IS NEVER SHOWN TO A CLIENT.
 *
 * The library lives in RevisionStudioIQ, which is the customer's surface. The
 * flattened master is the production authority and belongs to PanelPro Studio,
 * under the A.T.L.A.S. generation id. The tile briefly fell back to the master
 * for a design with no servable proof, which would have put that authority on a
 * customer's screen; a design with nothing servable now shows no tile and says
 * why. The master's own content hash is not published to this surface either.
 */
test("the library never serves the A.T.L.A.S. master to a customer", () => {
  // Comments stripped: the prose names the master in order to explain why it
  // is NOT the fallback, and a rule must not fail on its own statement.
  const tile = migration
    .slice(
      migration.indexOf("THE TILE IS A 3D PROOF"),
      migration.indexOf('AS "thumbnailStoragePath"'),
    )
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  assert.ok(tile.length > 0, "the tile expression must be findable");
  assert.ok(
    !tile.includes("master_storage_path"),
    "the tile must never fall back to the A.T.L.A.S. master",
  );
  assert.ok(
    !migration.includes("masterContentHash"),
    "the master's identity is PanelPro's, not the library's",
  );
  // The gateway refuses to sign anything outside this design's approved proofs
  // -- the flat-first subtree is deliberately not accepted here.
  assert.match(gateway, /const signable = storagePath\s*\n?\s*&& authorizedGenerationViewPath\(storagePath, ownerId, generationId\);/);
});

test("the tile is signed only inside the design's own prefix, and paths never leave", () => {
  assert.match(gateway, /authorizedGenerationViewPath\(storagePath, ownerId, generationId\)/);
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

/** Browse, then open. The PanelPro link left the customer card with the rest
 * of the production identity (owner, 2026-08-26); staff reach the control room
 * from the Production jobs cards. */
test("the library opens a design in the studio and carries no production identity", () => {
  assert.ok(!library.includes("/panelpro"), "no PanelPro link on the customer card");
  assert.ok(!/Design ID|Order\b.*number/i.test(library.replace(/\/\*[^]*?\*\/|^\s*\/\/.*$/gm, "")),
    "no identity facts on the customer card");
  assert.match(library, /onOpen\?\.\(entry\.generationId\)/);
  // One mount, and it is the ONLY browse grid on the page now -- the
  // vehicle-grouped feed it replaced no longer renders.
  assert.match(studio, /<DesignLibrary\s+onOpen=\{openDesignById\}/);
  assert.match(studio, /THE DUPLICATE VEHICLE-GROUPED GRID IS GONE\. ONE LIBRARY\./);
  // The page's own search box drives it, so there is one field over one list.
  assert.match(studio, /query=\{searchQuery\}/);
  // And the SPROKET tips the old grid carried are preserved in its empty state.
  assert.match(studio, /emptySlot=\{<SproketTipsSlideshow \/>\}/);
  // ONE CONTROL PER QUESTION. The page's header control drives the library's
  // pipeline filter, and the library then renders no second set of pipeline
  // buttons -- otherwise two controls on screen answer the same question and
  // can disagree.
  assert.match(studio, /pipeline=\{pipelineFilter\}/);
  assert.match(library, /externalPipeline === undefined && \(/);
  // Opening resolves against the server when the feed cannot answer, which is
  // most of the library.
  assert.match(studio, /readRevisionStudioDesign\(id\)/);
});

/**
 * THE HEADER CONTROL FILTERS BY PIPELINE, NOT BY A TOOL THIS OS DOES NOT HAVE.
 *
 * It arrived from RestylePro as a fifteen-option tool picker -- ColorPro,
 * FadeWraps, GraphicsPro, ApprovePro, WBTY, MyVehiclePro, WallPro. DesignPro OS
 * projects every row it can load with `mode_type: "designpanelpro"`, so those
 * options could only ever empty GalleryMode, and "DesignProAI" did exactly what
 * "All Tools" did. A control whose only real settings are "everything" and
 * "nothing" reads as broken, because it is.
 */
test("the studio's header filter offers the two answers that exist", () => {
  assert.ok(!studio.includes("modeFilter"), "the dead tool filter must be gone");
  for (const ghost of ["ColorPro", "FadeWraps", "GraphicsPro", "WBTY", "MyVehiclePro"]) {
    assert.ok(
      !studio.includes(`<SelectItem value="${ghost.toLowerCase()}"`),
      `the header must not offer ${ghost}: this OS holds no such row`,
    );
  }
  // Neutral customer wording (owner, 2026-08-26): the engine's name never
  // appears on the customer surface. The values stay the internal keys.
  assert.match(studio, /<SelectItem value="atlas">Current designs<\/SelectItem>/);
  assert.match(studio, /<SelectItem value="standard">Classic designs<\/SelectItem>/);
  for (const surface of ["../app/src/components/revisioniq/DesignLibrary.tsx"]) void surface;
  assert.ok(
    !/A\.T\.L\.A\.S\./.test(library.replace(/\/\*[^]*?\*\/|^\s*\/\/.*$/gm, "")),
    "the library renders no A.T.L.A.S. vocabulary to the customer",
  );
  // GalleryMode reads the same filter, so the two surfaces cannot disagree...
  assert.match(
    studio,
    /pipelineFilter !== "all" && r\.pipeline && r\.pipeline !== pipelineFilter/,
  );
  // ...and an unreported pipeline is never treated as "the other one".
  assert.match(
    source,
    /pipeline: "atlas" \| "standard" \| null;/,
  );
  assert.match(source, /pipeline: entry\.pipeline,/);
  assert.match(source, /pipeline: null,/);
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

/**
 * THE LIBRARY CARD READS THE WAY THE STUDIO'S CARDS READ.
 *
 * RevisionStudioIQ names a design by its VEHICLE and subtitles it with the
 * company and the finish -- "2020 ford f 150" over "Flamingo Pools · Gloss" --
 * stamps the version on the image, and dates it in words. Matching that is what
 * keeps the library part of the product instead of an admin table bolted to the
 * top of it, and it is the difference a person notices first.
 */
test("the library card follows the studio's own card conventions", () => {
  // Vehicle is the title; company and finish are the subtitle.
  assert.match(library, /function titleOf/);
  assert.match(library, /entry\.vehicle\?\.year, entry\.vehicle\?\.make, entry\.vehicle\?\.model/);
  assert.match(library, /function subtitleOf/);
  assert.match(library, /entry\.companyName \|\| entry\.designName/);
  // The version is stamped on the image, as the studio's cards stamp it -- and
  // a Standard run carries no badge rather than a fabricated V1.
  assert.match(library, /entry\.currentRevision \? \(/);
  assert.match(library, /V\{entry\.currentRevision\}/);
  // Dated in words, with the exact timestamp kept as the title attribute.
  assert.match(library, /function relativeAge/);
  assert.match(library, /title=\{`\$\{shortDate\(entry\.createdAt\)\}/);
  // The tool badge every DesignProAI card carries.
  assert.ok(library.includes("DesignProAI"), "the card must carry the tool badge");
});
