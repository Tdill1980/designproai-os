import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  generationIdOf, mergedStages, requestedProductionRun, requestedRun, runsForGeneration, sourceEnticeRunOf,
} from "../gateway/src/run-identity.mjs";

/**
 * THE FILES MUST END UP ON PANELPRO STUDIO. (Trish 2026-09-15)
 *
 * The production run never carried its generation id, so a job resolved by
 * generation id only ever reached the entice run: the board listed six panels
 * and never the upscaled masters, outputs, ZIP or WrapBox manifest the paid run
 * produced, and its gate approvals answered production_job_required. Pack
 * 9dcf312d (F250) delivered everything and showed none of it.
 */
const GEN = "0abb738a-4fdd-4dd2-9d0f-6bfc61bbcb6a";
const entice = { id: "17c958fc-c41f-46ed-bc36-b3e40c245904", workflow_type: "designpro.entice_pack", results: { generationId: GEN }, created_at: "2026-09-14T23:16:38Z" };
const legacyProduction = { id: "9dcf312d-fe84-463d-870f-5d4110bf8c11", workflow_type: "designpro.production_pack", results: { sourceEnticeRunId: entice.id }, created_at: "2026-09-14T23:17:46Z" };
const seededProduction = { ...legacyProduction, results: { sourceEnticeRunId: entice.id, generationId: GEN } };
const other = { id: "ffffffff-0000-4000-8000-000000000001", workflow_type: "designpro.entice_pack", results: { generationId: "11111111-1111-4111-8111-111111111111" } };

test("a production run created before the seed still resolves its generation through its source entice run", () => {
  const runs = [legacyProduction, entice, other];
  assert.equal(generationIdOf(legacyProduction, runs), GEN);
  assert.equal(generationIdOf(seededProduction, []), GEN);
  assert.equal(sourceEnticeRunOf(legacyProduction, runs), entice);
  assert.equal(sourceEnticeRunOf(entice, runs), null);
  assert.deepEqual(runsForGeneration(runs, GEN).map((run) => run.id), [legacyProduction.id, entice.id]);
});

test("the job, its artifacts and its gates resolve to the production run once one exists", () => {
  const runs = [legacyProduction, entice, other];
  assert.equal(requestedProductionRun(runs, GEN), legacyProduction);
  assert.equal(requestedProductionRun([entice, other], GEN), entice, "before purchase the entice run is the job");
  assert.equal(requestedProductionRun(runs, "nope"), null);
});

test("purchase, fulfillment, views and the atlas keep resolving to the entice run", () => {
  const runs = [seededProduction, entice, other];
  assert.equal(requestedRun(runs, GEN), entice);
  assert.equal(requestedRun(runs, seededProduction.id), seededProduction, "a run asked for by its own id is that run");
  assert.equal(requestedRun(runs, entice.id), entice);
});

test("a job page carries the whole chain: entice stages, then production stages, no duplicates", () => {
  const merged = mergedStages(
    [{ stage_key: "revision.freeze" }, { stage_key: "panels.build" }, { stage_key: "pack.activate" }],
    [{ stage_key: "await_purchase" }, { stage_key: "await_final_human_qc" }, { stage_key: "panels.build" }],
  );
  assert.deepEqual(merged.map((stage) => stage.stage_key),
    ["revision.freeze", "panels.build", "pack.activate", "await_purchase", "await_final_human_qc"]);
});

test("the gateway routes the job page, the artifact list and the surface QC through the production resolver", () => {
  const gateway = readFileSync(new URL("../gateway/src/server.mjs", import.meta.url), "utf8");
  assert.match(gateway, /from "\.\/run-identity\.mjs"/);
  assert.match(gateway, /const run = requestedProductionRun\(runs, requestedArtifactId\);/, "artifacts");
  assert.match(gateway, /const run = requestedProductionRun\(runs, requestedId\);/, "job page, resume and approvals");
  assert.match(gateway, /const run = requestedProductionRun\(runs, generationIdValue\);/, "surface QC");
  assert.match(gateway, /publicState\(await fullRunState\(fetchImpl, token, cfg, run, runs\)\)/, "the job page merges the entice stages in");
  assert.match(gateway, /generationId: generationIdOf\(run, runs\),/, "the projected generation id is the real one");
  // The entice-preferring resolver still exists for the design-keyed sites.
  assert.match(gateway, /function requestedRun\(runs, requestedGenerationId\) \{\n  return requestedEnticeRun\(runs, requestedGenerationId\);/);
});

test("the creator RPC seeds generationId and existing production runs are backfilled", () => {
  const migration = readFileSync(new URL("../supabase/migrations/20260915010000_designpro_production_run_generation_identity.sql", import.meta.url), "utf8");
  assert.match(migration, /''generationId'',v_entice\.results->>''generationId''/);
  assert.match(migration, /production_workflow_creator_anchor_not_unique/);
  assert.match(migration, /UPDATE public\.designpro_workflow_runs p/);
  assert.match(migration, /NULLIF\(p\.results->>'generationId',''\) IS NULL/);
  assert.match(migration, /e\.id::text=p\.results->>'sourceEnticeRunId'/);
});
