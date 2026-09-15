/**
 * WHICH RUN IS "THE JOB" FOR A GENERATION.
 *
 * A generation has at most two manufacturing runs: the free entice pack and,
 * once the pack is ordered, the paid production pack the database creates from
 * it. The production run never carried `results.generationId` (the creator RPC
 * seeded only `sourceEnticeRunId`), so resolving a job by generation id could
 * only ever find the entice run. Live on the F250 pack 9dcf312d (2026-09-15):
 * PanelPro Studio opened on the generation id, listed the entice artifacts, and
 * never saw the six upscaled masters, the eighteen outputs, the ZIP or the
 * WrapBox manifest -- and its approve buttons answered `production_job_required`
 * because the gates were being asked of the entice run.
 *
 * Two resolvers, chosen deliberately per call site:
 * - `requestedRun` prefers the ENTICE run. Purchase, fulfillment binding, the
 *   approved views and the atlas are keyed to the design and its free run; they
 *   must not drift to the production run just because one now exists.
 * - `requestedProductionRun` prefers the PRODUCTION run. The job page, the
 *   artifact list, the human gates and the per-surface QC are about the pack
 *   being manufactured; before purchase there is no such run and the entice run
 *   answers exactly as before.
 *
 * A production run's generation id is read off its own results and, when that
 * is missing (rows created before 20260915010000), off its source entice run.
 */

const ENTICE = "designpro.entice_pack";
const PRODUCTION = "designpro.production_pack";

function ownGenerationId(run) {
  const value = run?.results?.generationId || run?.results?.generation_id
    || run?.input?.generationId || run?.input?.generation_id;
  return value ? String(value) : null;
}

export function sourceEnticeRunOf(run, runs) {
  if (!run || run.workflow_type !== PRODUCTION) return null;
  const sourceRunId = String(run.results?.sourceEnticeRunId || run.input?.sourceEnticeRunId || "");
  return (runs || []).find((candidate) => candidate.id === sourceRunId && candidate.workflow_type === ENTICE) || null;
}

/** The generation this run manufactures; the run id only when nothing states it. */
export function generationIdOf(run, runs = []) {
  const own = ownGenerationId(run);
  if (own) return own;
  const source = sourceEnticeRunOf(run, runs);
  const inherited = source ? ownGenerationId(source) : null;
  return inherited || String(run?.id || "");
}

/** Every run that manufactures this generation, in the order the list arrived (newest first). */
export function runsForGeneration(runs, requestedId) {
  const wanted = String(requestedId || "");
  if (!wanted) return [];
  return (runs || []).filter((run) => run.id === wanted || generationIdOf(run, runs) === wanted);
}

function preferring(runs, requestedId, workflowType) {
  const candidates = runsForGeneration(runs, requestedId);
  // A run asked for by its own id is that run, whatever its type.
  const exact = candidates.find((run) => run.id === String(requestedId || ""));
  if (exact) return exact;
  return candidates.find((run) => run.workflow_type === workflowType) || candidates[0] || null;
}

/** The design's run: the entice pack when it exists, else whatever manufactures it. */
export function requestedRun(runs, requestedId) {
  return preferring(runs, requestedId, ENTICE);
}

/** The pack being manufactured: the production run once ordered, else the entice run. */
export function requestedProductionRun(runs, requestedId) {
  return preferring(runs, requestedId, PRODUCTION);
}

/**
 * The stages a job page reads: the source entice run's stages first, then the
 * production run's. Consumers already look for both halves in one list --
 * Production Layers wants `panels.build` (entice) and `await_final_human_qc`
 * (production) from the same status -- and stage keys never overlap between the
 * two workflows, so the merge is a concatenation.
 */
export function mergedStages(enticeStages, productionStages) {
  const seen = new Set();
  const out = [];
  for (const stage of [...(enticeStages || []), ...(productionStages || [])]) {
    const key = String(stage?.stage_key || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(stage);
  }
  return out;
}
