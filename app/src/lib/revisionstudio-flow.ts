/**
 * THE SERVER CONDUCTS. THE BROWSER SUBMITS AND OBSERVES.
 *
 * RevisionStudioIQ used to drive the production half itself: it called the
 * `designpro-file-output-api` edge function to submit a revision, resume a run
 * and poll its status, and it wrote the design's own `render_urls` back to a
 * table. That is browser-owned orchestration, which the canonical contract
 * retires -- and every one of those names is on the customer-path seam gate's
 * forbidden list.
 *
 * This module is the replacement, exposing the same four operations the page
 * already calls, in the same shapes, so the page's ~9,800 lines of UI stay
 * exactly as they are. Underneath, each one is the server's own equivalent:
 *
 *   getDesignBuildStatus  ->  dpApi.getStatus + dpApi.listArtifacts
 *   requestDesignBuild     ->  dpApi.requestResume
 *   resumeDesignBuild     ->  dpApi.requestResume
 *   readDesignAfterEdit       ->  a re-read, because the browser writes nothing
 *
 * WHY SUBMIT AND RESUME ARE THE SAME CALL. In the old world "submit" created a
 * run from a frozen visualization row and "resume" restarted one. Here the run
 * already exists -- the A.T.L.A.S. handoff created it the moment the master was
 * accepted -- so the only honest action a browser has is to ask the server to
 * make pending and retryable work available again. `resume_designpro_workflow`
 * is that action, it never steals an unexpired lease, and it is idempotent.
 *
 * WHY SAVE WRITES NOTHING. A design's views are server-owned artifacts, hashed
 * and bound to the accepted master. A browser that persisted its own copy of
 * `render_urls` would be a second producer of the thing the whole pipeline is
 * anchored to. So the save re-reads the run and returns what the server
 * actually holds; if the page's optimistic copy disagreed, the server's answer
 * is the one that survives.
 */
import { dpApi, FLAT_FIRST_ATLAS_PIPELINE_MODE } from "@/lib/designpro-api";
import { selectCustomerProof } from "@/lib/designpro-artifact-selectors";
import { readRevisionStudioDesign } from "@/lib/revisionstudio-source";

/** What the page labels a build with. Kept verbatim so call sites are unchanged. */
export type DesignBuildTrigger =
  | "revision_saved"
  | "proof_requested"
  | "precise_edit"
  | "finish_fixed"
  | "missing_views_completed"
  | "passenger_mirrored"
  | "view_deleted"
  | "view_regenerated"
  | "design_generated"
  | "layer_edit"
  | "manual";

export type DesignBuildStatus = {
  workflowRun: { id: string; workflow_status: string } | null;
  proofUrl: string | null;
  activePack: { proof_artifact: { url: string } | null } | null;
};

/**
 * The durable workflow states the page's poll compares against.
 *
 * The page stops polling on completed/cancelled/failed and keeps polling
 * otherwise, so the run's state has to arrive under those exact words. This is
 * the whole translation, and it is deliberately total: every server state maps
 * to one of them rather than falling through to a default that would poll for
 * ever.
 */
function workflowStatusFor(state: string): string {
  if (state === "complete") return "completed";
  if (state === "failed") return "failed";
  // A run parked on a human action -- GENIE dimensions, preflight QC, final QC
  // -- is neither finished nor progressing on its own. It is reported as
  // running so the page keeps watching it, because the thing it is waiting for
  // is a person, and when that person acts the state moves without a new poll.
  return "running";
}

/**
 * One design's durable build state, for the 2D proof panel.
 *
 * The locator is whatever id the caller holds; here a design has one id, so
 * both the visualization and the run resolve to the same generation.
 */
export async function getDesignBuildStatus(locator: {
  visualizationId?: string | null;
  generationId?: string | null;
  runId?: string | null;
}): Promise<DesignBuildStatus> {
  const id = String(
    locator.generationId || locator.visualizationId || locator.runId || "",
  ).trim();
  const empty: DesignBuildStatus = {
    workflowRun: null,
    proofUrl: null,
    activePack: null,
  };
  if (!id) return empty;
  const job = await dpApi.getStatus(id).catch(() => null);
  if (!job) return empty;
  const artifacts = await dpApi.listArtifacts(job.generationId).catch(() => []);
  const proof = selectCustomerProof(artifacts);
  const proofUrl = proof?.signedUrl || null;
  return {
    workflowRun: {
      id: job.generationId,
      workflow_status: workflowStatusFor(job.state),
    },
    proofUrl: proofUrl,
    activePack: proofUrl ? { proof_artifact: { url: proofUrl } } : null,
  };
}

/**
 * Ask the server to make this design's pending and retryable work available.
 *
 * `idempotent` is reported true whenever the run is already past the point this
 * call would have started, so the page's "already being processed" message is
 * accurate rather than a guess.
 */
export async function requestDesignBuild(input: {
  visualizationId?: string | null;
  generationId?: string | null;
  expectedUpdatedAt?: string | null;
  trigger?: DesignBuildTrigger;
  change?: unknown;
}): Promise<{ idempotent: boolean }> {
  const id = String(input.generationId || input.visualizationId || "").trim();
  if (!id) throw new Error("no design is selected");
  const before = await dpApi.getStatus(id).catch(() => null);
  await dpApi.requestResume(id);
  return { idempotent: before?.state === "running" || before?.state === "complete" };
}

/** Same server action, from the page's retry button. */
export async function resumeDesignBuild(
  runId: string,
  _retryFailed = false,
): Promise<{ idempotent: boolean }> {
  const id = String(runId || "").trim();
  if (!id) throw new Error("no run to resume");
  await dpApi.requestResume(id);
  return { idempotent: false };
}

/**
 * A revision, authored by A.T.L.A.S. from the customer's requested change.
 *
 * The design a customer sees is seven projections of one flattened master, so
 * "revise this" means authoring a new master from a revised brief -- never
 * repainting a proof, which could only make one view disagree with the master
 * the panels are cut from. The gateway enforces exactly this: a per-view
 * regenerate against a flat-first request is refused outright.
 *
 * The source design is not touched. Its master, proofs and panels stay valid
 * and inspectable, which is what makes a version history real rather than a
 * label on an overwritten row.
 *
 * The brief sent is the source design's own brief plus the requested change,
 * in that order, so the revision inherits everything the customer already said
 * instead of being authored from one sentence.
 */
export async function submitDesignRevision(input: {
  source: {
    id?: string | null;
    admin_notes?: string | null;
    finish_type?: string | null;
    vehicle_type?: string | null;
    color_name?: string | null;
    design_file_name?: string | null;
  } | null;
  instruction: string;
  vehicle: { year: string; make: string; model: string };
  designName: string;
}): Promise<{ generationId: string }> {
  const instruction = String(input.instruction || "").trim();
  if (!instruction) throw new Error("A revision needs a description of the change.");

  let notes: Record<string, unknown> = {};
  try {
    notes = input.source?.admin_notes ? JSON.parse(input.source.admin_notes) : {};
  } catch {
    notes = {};
  }
  const originalBrief = String(notes.original_prompt || "").trim();
  const brief = originalBrief ? `${originalBrief}\n\nRevision: ${instruction}` : instruction;

  const created = await dpApi.createGenerationRequest({
    pipelineMode: FLAT_FIRST_ATLAS_PIPELINE_MODE,
    designName: input.designName.slice(0, 240),
    vehicle: {
      year: String(input.vehicle.year || "").trim(),
      make: String(input.vehicle.make || "").trim(),
      model: String(input.vehicle.model || "").trim(),
      // The vehicle class the server validates against. A design carries its
      // own; anything else would be this browser reclassifying the customer's
      // vehicle on their behalf.
      type: String(input.source?.vehicle_type || "car"),
    },
    brief: {
      brief: brief.slice(0, 8000),
      ...(input.source?.finish_type ? { finish: String(input.source.finish_type) } : {}),
    },
  });
  return { generationId: created.generationId };
}

/**
 * What the page's "persist this revision" path becomes: a re-read.
 *
 * The caller hands over the view URLs it just displayed and a patch for the
 * design's notes. Neither is written. The views belong to the server and the
 * notes are a projection of server state, so the honest response is the current
 * row -- which is also what every caller does with the return value: it sets it
 * as the selected design.
 */
export async function readDesignAfterEdit(input: {
  render: { id?: string | null } | null;
  renderUrls?: Record<string, string>;
  trigger?: DesignBuildTrigger;
  change?: unknown;
  patch?: Record<string, unknown>;
}): Promise<{
  render_urls: Record<string, string>;
  admin_notes: string | null;
  updated_at: string | null;
}> {
  const id = String(input.render?.id || "").trim();
  if (!id) throw new Error("No saved design is selected");
  const row = await readRevisionStudioDesign(id);
  if (!row) throw new Error("this design is not a saved revision on the server");
  return {
    render_urls: row.render_urls,
    admin_notes: row.admin_notes,
    updated_at: row.updated_at,
  };
}
