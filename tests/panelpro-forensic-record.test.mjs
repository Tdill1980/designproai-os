import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const panelPro = readFileSync(
  new URL("../app/src/pages/AdminGeminiCompareStudio.tsx", import.meta.url),
  "utf8",
);
const app = readFileSync(new URL("../app/src/App.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../app/src/lib/designpro-api.ts", import.meta.url), "utf8");
const gateway = readFileSync(new URL("../gateway/src/server.mjs", import.meta.url), "utf8");
const migration = readFileSync(new URL(
  "../supabase/migrations/20260826030000_designpro_revision_studio_surface.sql",
  import.meta.url,
), "utf8");

/**
 * WHICH COMPONENT IS PANELPRO STUDIO IS A QUESTION THE REPOSITORY ANSWERS.
 *
 * `3bc41b6` moved /panelpro onto the full Admin Studio deliberately -- "The
 * PanelPro route mounts the full Admin Studio, which opens the job the URL
 * names; the per-surface validator keeps its own path one level down." The
 * per-surface board keeps its own route. Both are real surfaces; only one is
 * the control room.
 */
test("the canonical PanelPro Studio is what /panelpro renders", () => {
  assert.match(
    app,
    /path="\/designpro\/jobs\/:generationId\/panelpro"\s+element=\{<RequireAuth><AdminGeminiCompareStudio \/><\/RequireAuth>\}/,
  );
  assert.match(
    app,
    /path="\/designpro\/jobs\/:generationId\/panelpro\/surfaces"\s+element=\{<RequireAuth><PanelProStudioBoard \/><\/RequireAuth>\}/,
  );
});

/**
 * THE MASTER'S OWN RECORD BELONGS IN THE UI, NOT IN A DIAGNOSTIC LOG.
 *
 * Every value below was written by Call 1 at authoring time and sat on the
 * revision unread. They are the first questions asked when a panel looks wrong.
 */
test("PanelPro exposes the master's QC verdict and provenance", () => {
  // Published by the database…
  assert.match(migration, /'masterQcPassed',r\.metadata->'masterQcPassed'/);
  assert.match(migration, /'masterAuthoringAttempts'/);
  assert.match(migration, /'masterCutoutSurfaces'/);
  assert.match(migration, /'panelSourceHash'/);
  assert.match(migration, /'canonicalMasterHash'/);
  // …carried by the gateway…
  assert.match(gateway, /qc: row\.qc && typeof row\.qc === "object"/);
  assert.match(gateway, /provenance: row\.provenance/);
  // …typed for the client…
  assert.match(api, /masterQcPassed\?: boolean \| null/);
  assert.match(api, /masterCutoutSurfaces\?: string\[\]/);
  // …and rendered.
  assert.match(panelPro, /function AtlasForensicRecord/);
  assert.match(panelPro, /<AtlasForensicRecord atlas=\{atlas\} \/>/);
  for (const fact of [
    "Master QC", "QC confidence", "QC model", "Authoring attempts",
    "Authoring model", "Prompt version", "Pipeline mode", "Provider contract",
    "Canonical master", "Panels cut from",
  ]) {
    assert.ok(panelPro.includes(fact), `PanelPro must state ${fact}`);
  }
});

/**
 * A CUT-OUT IS A PRINT DEFECT, NOT A BROKEN DESIGN -- and how much was missing
 * is the number that decides whether the proofs were safe. `zoneFraction` 0.04
 * is a wheel arch; 0.27 is a vehicle silhouette, which is what the 2026-08-26
 * canary turned on. So it is stated per surface rather than summarised.
 */
test("PanelPro states the cut-out and fill record per surface", () => {
  assert.match(panelPro, /Cut-outs \{fills\.length > 0 \? "found and filled" : "recorded"\}/);
  assert.match(panelPro, /fill\.zoneFraction \* 100/);
  for (const column of ["Surface", "Share of zone", "Pixels", "Shapes", "Unresolved"]) {
    assert.ok(panelPro.includes(column), `the fill table must state ${column}`);
  }
  // The panels' true source is named, and whether it differs from the master.
  assert.match(panelPro, /repaired sheet/);
  assert.match(panelPro, /same as master/);
});

/**
 * ⛔ AND NONE OF IT REACHES THE CUSTOMER. The forensic record is read from the
 * atlas route, which the customer's library and workspace do not call.
 */
test("the forensic record is PanelPro's alone", () => {
  const library = readFileSync(
    new URL("../app/src/components/revisioniq/DesignLibrary.tsx", import.meta.url),
    "utf8",
  );
  const versionCard = readFileSync(
    new URL("../app/src/components/revisioniq/DesignVersionRecordCard.tsx", import.meta.url),
    "utf8",
  );
  for (const surface of [library, versionCard]) {
    for (const admin of ["masterQcPassed", "cutoutFill", "masterCutout", "provenance", "promptVersion"]) {
      assert.ok(!surface.includes(admin), `the customer's surface must not carry ${admin}`);
    }
  }
});
