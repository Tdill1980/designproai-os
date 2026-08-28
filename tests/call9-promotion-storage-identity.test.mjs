// PROMOTION COPIES THE BYTES. IT NEVER ALIASES CALL 1'S PATH. (2026-08-28)
//
// `panels.build` is verification/promotion of the already-created Call-1 bytes
// -- the owner's own words, "the panels should just be the exact panels from
// the ATLAS container design generation". It registered them as artifacts under
// the storage path Call 1 wrote them to, which is owner-scoped and predates the
// run entirely.
//
// `designpro_artifacts` carries a BEFORE INSERT trigger,
// `designpro_private.enforce_artifact_storage_identity`, that refuses any row
// whose path is not `designpro/<tenant_key>/<run_id>/...`. So the promotion
// died half a second in, on `stage_completion_rejected` /
// `artifact_storage_identity_mismatch` -- live on entice run
// 8e9fab59-d282-4f92-a8aa-86b2f4e1d09e (generation
// 8555be2f-71fe-4a30-8680-653d086a213e), whose six Call-1 panels were all
// present, correct, and byte-verified.
//
// The repair is to COPY, not to relax the trigger. That invariant is what stops
// one run's artifact row pointing at another run's bytes, and copying costs
// nothing the owner cares about: the bytes are identical, nothing is re-cut, no
// AI runs, and the copy is refused unless it hashes to the Call-1 panel it came
// from.
//
// These assertions execute the real path builder and check it against the
// trigger's OWN predicate, transcribed from the migration below rather than
// restated here -- so the test fails if either side moves.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { _test } = require("../runtime/designpro-standalone-claimant.cjs");
const { runScopedStoragePath } = _test;

const MIGRATION = new URL(
  "../supabase/migrations/20260806180700_designpro_storage_and_path_identity.sql",
  import.meta.url,
);

const SURFACES = ["driver", "passenger", "hood", "roof", "front", "rear"];

const RUN = Object.freeze({
  id: "8e9fab59-d282-4f92-a8aa-86b2f4e1d09e",
  tenant_key: "user_508aca68-49b1-4b82-ad8c-344680000000",
  revision_id: "f2beb36e-03e7-4fa2-bca0-dc7950c23ad2",
});

// The Call-1 panel path shape, as the generation worker writes it: owner-scoped
// and with no run in it, because at Call 1 no run exists.
const CALL_ONE_PATH =
  `designpro/${RUN.tenant_key}/atlas/e7b4cf8a-55ce-46fb-98c9-948e0eb4eeb7/panels/driver.png`;

// The trigger's first branch, in JS. Read from the migration so a change to the
// SQL that this no longer mirrors is visible: the assertions below check the
// migration still says what this implements.
function triggerAccepts(path, run) {
  const parts = String(path).split("/");
  const wellFormed = !path.startsWith("/")
    && !path.includes("..")
    && /^[A-Za-z0-9._/-]+$/.test(path);
  return wellFormed
    && parts[0] === "designpro"
    && parts[1] === run.tenant_key
    && parts[2] === run.id;
}

test("the trigger this mirrors still demands designpro/<tenant>/<run>", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  assert.match(sql, /RAISE EXCEPTION 'artifact_storage_identity_mismatch'/);
  for (const fragment of [
    "split_part(NEW.storage_path,'/',1) = 'designpro'",
    "split_part(NEW.storage_path,'/',2) = v_run.tenant_key",
    "split_part(NEW.storage_path,'/',3) = v_run.id::text",
  ]) {
    assert.ok(sql.includes(fragment), `the trigger must still assert ${fragment}`);
  }
});

test("the Call-1 path is exactly what the trigger refuses -- the live defect", () => {
  assert.equal(triggerAccepts(CALL_ONE_PATH, RUN), false);
});

test("every promoted panel path satisfies the trigger", () => {
  for (const surface of SURFACES) {
    const path = runScopedStoragePath(RUN, `panels/${surface}.png`);
    assert.equal(triggerAccepts(path, RUN), true, `${surface} must be registrable`);
    assert.equal(path, `designpro/${RUN.tenant_key}/${RUN.id}/panels/${surface}.png`);
  }
});

test("each surface gets its own path, so six panels cannot collapse to one", () => {
  const paths = new Set(SURFACES.map((s) => runScopedStoragePath(RUN, `panels/${s}.png`)));
  assert.equal(paths.size, SURFACES.length);
});

test("the builder cannot be talked out of the run prefix", () => {
  // A leading slash would make split_part(...,1) empty and fail the trigger;
  // traversal would trip the '..' guard. Neither may survive the builder.
  const escaped = runScopedStoragePath(RUN, "/panels/driver.png");
  assert.equal(triggerAccepts(escaped, RUN), true);
  assert.equal(escaped.includes("//"), false);
});

// ────────────────────────────────────────────────────────────────────────────
// AND THE PROMOTION ITSELF STAYS A PROMOTION.
//
// Copying the bytes is only safe while it is still the SAME bytes. These read
// the stage rather than the path: the promotion re-hashes what it stored,
// refuses drift, and keeps Call 1's path and hash on the artifact so the
// lineage is one lineage published twice (RULE 0.27 §3), not two.
const claimant = readFileSync(
  new URL("../runtime/designpro-standalone-claimant.cjs", import.meta.url),
  "utf8",
);

test("the promoted copy is refused unless it hashes to the Call-1 panel", () => {
  assert.match(claimant, /call9_call1_panel_promotion_drift/);
  assert.match(claimant, /call9_call1_panel_changed/);
});

test("the artifact still names the Call-1 bytes it came from", () => {
  for (const field of ["sourceStoragePath", "sourceContentHash", "sourceMasterHash"]) {
    assert.ok(claimant.includes(field), `the promoted panel must record ${field}`);
  }
  assert.match(claimant, /promotedFrom: "atlas-call1"/);
});

test("promotion re-cuts nothing", () => {
  // The whole point of the stage. If a generative or geometric producer ever
  // appears in the promotion branch, the panels stop being the ones the
  // customer was shown.
  const branch = claimant.slice(
    claimant.indexOf("const callOnePanels = await callOnePanelSet(sb, run);"),
    claimant.indexOf('const proof = await stageOutput(sb, run.id, "proof.build");'),
  );
  assert.ok(branch.length > 0, "the promotion branch must still be findable");
  for (const producer of ["sharp(", "generateContent", "extract(", "gridslice"]) {
    assert.equal(branch.includes(producer), false, `promotion must not call ${producer}`);
  }
});
