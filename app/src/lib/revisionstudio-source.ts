/**
 * The server-owned source behind RevisionStudioIQ.
 *
 * RevisionStudioIQ is the migrated product UI and stays exactly as it is. What
 * changed underneath it is where a design comes from: it used to select
 * `color_visualizations` and fall back through `designiq_generations` -- both
 * RestylePro tables that hold zero rows in DesignProAI, and both on the
 * customer-path seam gate's forbidden list precisely because they are a second
 * door onto a design. The designs live in the run tables the gateway owns,
 * reachable only through `dpApi`.
 *
 * So this adapter returns rows carrying the SAME field names the page already
 * reads -- `id`, `render_urls`, `vehicle_make`, `design_file_name`,
 * `finish_type`, `admin_notes` and the rest -- assembled from `dpApi`. That is
 * deliberate: it keeps the port at the data seam and leaves every one of the
 * page's ~9,800 lines of layout, cards, GalleryMode, search and actions
 * untouched. A field the server genuinely does not have is null, never a
 * placeholder, because a card that invents a vehicle is worse than a card that
 * omits one.
 *
 * ONE IDENTITY. In RestylePro a design had three ids -- a visualization row, a
 * DesignIQ generation, and a panelizer job -- and most of the legacy lookups in
 * that page existed only to resolve between them. Here `generationId` is the
 * design, so `admin_notes.designiq_generation_id` is that same id and every
 * resolver collapses to identity. Those notes are synthesized fresh on each
 * read rather than stored: they are a projection of server state, so there is
 * nothing to write back and nothing that can drift.
 *
 * A.T.L.A.S. INTERNALS ARE NOT IN HERE. The flattened master, its content hash,
 * the guide, the topology and the prompt version are admin/design-team material
 * (canonical contract, "ATLAS visibility"). RevisionStudio is the customer's
 * surface, so it gets the seven proofs, the production proof and the panels --
 * never the master. PanelPro Studio is where the lineage is inspected.
 */
import {
  dpApi,
  ROLE_FOR_SOURCE_VIEW_TYPE,
  type ApprovedGenerationView,
  type WorkflowArtifact,
  type WorkflowStatus,
} from "@/lib/designpro-api";
import { selectCustomerProof } from "@/lib/designpro-artifact-selectors";
import {
  loadDesignVersionHistory,
  versionCommitsFromHistory,
} from "@/lib/design-version-history";

/**
 * One design as the page consumes it. The names are the legacy column names on
 * purpose -- they are the contract the existing UI is written against, and
 * renaming them here would mean editing the UI, which is the one thing this
 * migration must not do.
 */
export type RevisionStudioDesignRow = {
  id: string;
  render_urls: Record<string, string>;
  vehicle_year: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_type: string | null;
  design_file_name: string | null;
  color_name: string | null;
  color_hex: string | null;
  finish_type: string | null;
  mode_type: string;
  created_at: string | null;
  updated_at: string | null;
  generation_status: "completed";
  /** Synthesized projection of server state -- see the module note. */
  admin_notes: string;
  /** Columns the cards read but the run tables have no equivalent for. */
  custom_design_url: string | null;
  custom_swatch_url: string | null;
  custom_styling_prompt_key: string | null;
  uses_custom_design: boolean;
  customer_email: string | null;
  subscription_tier: string | null;
  organization_id: string | null;
  infusion_color_id: string | null;
  lineage_root_id: string | null;
  /** Server-owned identity the cards and their actions bind to. */
  design_id: string;
  order_number: string;
  revision: number;
  state: WorkflowStatus["state"];
  current_stage: string;
};

/** The tool badge every DesignProAI design card carries. */
const DESIGNPRO_MODE = "designpanelpro";

function text(value: unknown): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The seven approved views, keyed the way the card carousel expects.
 *
 * The grid's `render_urls` map is keyed by display role (driver, passenger,
 * hood, ...), while the server names a view by its camera (`sourceViewType`).
 * `ROLE_FOR_SOURCE_VIEW_TYPE` is the one translation table for that, so it is
 * reused here rather than a second mapping being written.
 *
 * The page's own view order is the camera vocabulary (`side`, `passenger-side`,
 * `hood_detail`, ...), so both keys are published for the same URL. That is not
 * a fuzzy fallback -- each entry is the exact identity the server stated, under
 * the two names the existing UI looks it up by.
 */
export function renderUrlsFromViews(views: readonly ApprovedGenerationView[]): Record<string, string> {
  const urls: Record<string, string> = {};
  for (const view of views) {
    if (!view.signedUrl) continue;
    const role = ROLE_FOR_SOURCE_VIEW_TYPE[view.sourceViewType];
    if (role) urls[role] = view.signedUrl;
    urls[view.sourceViewType] = view.signedUrl;
  }
  return urls;
}

/**
 * What the page's `JSON.parse(render.admin_notes)` reads, built from the run.
 *
 * Every key here answers a lookup the legacy page used to make against a table
 * that does not exist. `designiq_generation_id` is the generation itself,
 * `flat_proof_url` is the Call-8 customer proof artifact, `logo_pack` is the
 * Call-10 logo inventory, and `original_prompt` is the brief the design was
 * authored from. Absent values are simply absent -- the page already treats a
 * missing key as "not known", which is the honest answer.
 */
function adminNotesFor(input: {
  job: WorkflowStatus;
  artifacts: readonly WorkflowArtifact[];
}): string {
  const proof = selectCustomerProof([...input.artifacts]);
  const logoPack = input.artifacts
    .filter((artifact) => artifact.kind === "logo")
    .map((artifact) => ({
      url: artifact.signedUrl,
      label: String(artifact.metadata?.displayName || artifact.metadata?.identityKey || "Logo"),
    }));
  const notes: Record<string, unknown> = {
    designiq_generation_id: input.job.generationId,
    design_id: input.job.designId,
    wpw_order_number: input.job.orderNumber,
    order_number: input.job.orderNumber,
  };
  // The customer's brief, verbatim, under the key the page's prompt card and
  // its revision composer already read. Never a paraphrase: a revision is
  // authored from this text plus the requested change, so a summary here would
  // rebuild the design against words nobody typed.
  if (input.job.brief) notes.original_prompt = input.job.brief;
  if (proof?.signedUrl) notes.flat_proof_url = proof.signedUrl;
  if (logoPack.length) notes.logo_pack = logoPack;
  return JSON.stringify(notes);
}

/** Project one server job into the row shape the existing page reads. */
export function designRowFromJob(
  job: WorkflowStatus,
  views: readonly ApprovedGenerationView[],
  artifacts: readonly WorkflowArtifact[] = [],
): RevisionStudioDesignRow {
  return {
    id: job.generationId,
    render_urls: renderUrlsFromViews(views),
    vehicle_year: job.vehicle?.year ?? null,
    vehicle_make: job.vehicle?.make ?? null,
    vehicle_model: job.vehicle?.model ?? null,
    vehicle_type: job.vehicle?.type ?? null,
    // The card's title line is the design's own name; its subtitle pairs that
    // name with the finish ("Flamingo Pools - Gloss"), which is why both read
    // from the same projected value rather than from a colour row.
    design_file_name: text(job.designName),
    color_name: text(job.designName),
    color_hex: null,
    finish_type: text(job.finish),
    mode_type: DESIGNPRO_MODE,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
    generation_status: "completed",
    admin_notes: adminNotesFor({ job, artifacts }),
    custom_design_url: null,
    custom_swatch_url: null,
    custom_styling_prompt_key: text(job.brief),
    uses_custom_design: false,
    customer_email: null,
    subscription_tier: null,
    organization_id: null,
    infusion_color_id: null,
    // A design's lineage root is the design itself: a revision is a new
    // revision OF this generation, never a new generation that has to be
    // re-associated afterwards.
    lineage_root_id: job.generationId,
    design_id: job.designId,
    order_number: job.orderNumber,
    revision: job.revision,
    state: job.state,
    current_stage: job.currentStage,
  };
}

/** Views and artifacts for one run, each failing soft into an empty list. */
async function detailFor(generationId: string) {
  const [views, artifacts] = await Promise.all([
    // A run whose views cannot be read is still a real design and still gets a
    // card; it simply shows no preview yet. Dropping it would make a design
    // disappear from the customer's own studio because one signed URL failed.
    dpApi.listApprovedViews(generationId).catch(() => [] as ApprovedGenerationView[]),
    // Artifacts only exist after the production handoff, so an entice-stage run
    // legitimately has none.
    dpApi.listArtifacts(generationId).catch(() => [] as WorkflowArtifact[]),
  ]);
  return { views, artifacts };
}

/**
 * Every design this operator can open, newest first.
 *
 * Ownership is not filtered here. The gateway resolves it from the caller's own
 * session and returns only that account's runs, so re-filtering in the browser
 * would be a second, weaker copy of a rule the server already enforces.
 */
export async function listRevisionStudioDesigns(): Promise<RevisionStudioDesignRow[]> {
  const jobs = await dpApi.listJobs();
  const rows = await Promise.all(
    jobs.map(async (job) => {
      const { views, artifacts } = await detailFor(job.generationId);
      return designRowFromJob(job, views, artifacts);
    }),
  );
  return rows.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
}

/**
 * One design, re-read from the server.
 *
 * This is what the page's several "re-read the freshest row by id" paths become.
 * They existed because a proof was saved after the list loaded and the in-memory
 * copy went stale; the same is true here, so the read stays -- it just asks the
 * run tables instead of a visualization row. Returns null for an id the gateway
 * does not own, which is the honest answer and what every caller already
 * handles.
 */
export async function readRevisionStudioDesign(
  generationId: string,
): Promise<RevisionStudioDesignRow | null> {
  const id = String(generationId || "").trim();
  if (!id) return null;
  const job = await dpApi.getStatus(id).catch(() => null);
  if (!job) return null;
  const { views, artifacts } = await detailFor(job.generationId);
  return designRowFromJob(job, views, artifacts);
}

/**
 * What the layered logo editor floors its canvas on, for one surface.
 *
 * THE SERVER ALREADY SEPARATED THESE. The browser used to do it itself: call
 * `extract-logo-elements` to have an AI guess bounding boxes on the 2D proof,
 * alpha-key a slice out of each box, upload the slices, and then write them
 * into a design row as the "logo pack". That is a second producer of production
 * assets living in a tab, and every box it guessed was a guess.
 *
 * Call 10 separates the logo inventory server-side and Call 11 publishes the
 * de-logoed duplicate of each panel. So the clean base and the liftable
 * elements both already exist, hashed and bound to the accepted master, and
 * this reads them instead of re-deriving them. Nothing is uploaded and nothing
 * is written back.
 *
 * Returns a null `cleanUrl` when Call 11 has not published this surface yet,
 * which is the state the caller already reports honestly rather than papering
 * over -- an editor floored on a stale or invented base is worse than one that
 * says the assets are still building.
 */
export async function loadLayeredEditSources(
  generationId: string,
  surfaceKey: string,
): Promise<{ cleanUrl: string | null; logos: Array<{ url: string; label: string }> }> {
  const id = String(generationId || "").trim();
  const surface = String(surfaceKey || "").trim();
  if (!id || !surface) return { cleanUrl: null, logos: [] };
  const artifacts = await dpApi.listArtifacts(id).catch(() => [] as WorkflowArtifact[]);
  const clean = artifacts.find(
    (artifact) => artifact.kind === "qc-panel" && artifact.surfaceKey === surface,
  );
  const logos = artifacts
    .filter((artifact) => artifact.kind === "logo")
    // A logo separated for one surface belongs on that surface. One with no
    // surface of its own is part of the design's shared inventory and is
    // offered everywhere, which is how the logo pack has always behaved.
    .filter((artifact) => !artifact.surfaceKey || artifact.surfaceKey === surface)
    .map((artifact) => ({
      url: artifact.signedUrl,
      label: String(artifact.metadata?.displayName || artifact.metadata?.identityKey || "Logo"),
    }));
  return { cleanUrl: clean?.signedUrl || null, logos };
}

/**
 * The driver panel's real trim geometry, as the server stamped it.
 *
 * The cut sheet used to re-estimate a vehicle's body length and height in the
 * browser from a make and model. Call 1 already resolved that geometry and
 * stamped it on every panel it cut, so this reads the number the customer will
 * actually print against. Two independent estimates of one vehicle are two
 * numbers waiting to disagree; there is only one here.
 *
 * Null when Call 9 has not published the driver panel yet, which the caller
 * reports as "set a real vehicle" rather than guessing.
 */
export async function loadDriverPanelGeometry(generationId: string): Promise<
  { trimWidthIn: number; trimHeightIn: number; surfaceSqFt: number | null } | null
> {
  const id = String(generationId || "").trim();
  if (!id) return null;
  const artifacts = await dpApi.listArtifacts(id).catch(() => [] as WorkflowArtifact[]);
  const driver = artifacts.find(
    (artifact) => artifact.kind === "panel" && artifact.surfaceKey === "driver",
  );
  const width = Number(driver?.metadata?.trimWidthIn);
  const height = Number(driver?.metadata?.trimHeightIn);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return null;
  const sqft = Number(driver?.metadata?.surfaceSqFt);
  return {
    trimWidthIn: width,
    trimHeightIn: height,
    surfaceSqFt: Number.isFinite(sqft) && sqft > 0 ? sqft : null,
  };
}

/**
 * THE DESIGN'S VERSION HISTORY — from the one canonical source.
 *
 * This used to return the design row itself, which was a truthful answer to
 * "what is this design" and not an answer to "what versions has it been
 * through". Meanwhile PanelPro read the server's real A.T.L.A.S. revision list.
 * Two surfaces looking at one job and reporting different histories is the
 * thing a shared lineage is supposed to make impossible.
 *
 * Both now call `loadDesignVersionHistory`, so V2 means the same version, with
 * the same prompt text and the same timestamp, wherever it is shown. There is
 * no second table, no separate numbering, and nothing copied between surfaces.
 */
export async function listRevisionStudioVersions(
  generationId: string,
): Promise<RevisionStudioDesignRow[]> {
  const row = await readRevisionStudioDesign(generationId);
  return row ? [row] : [];
}

/**
 * The canonical version and prompt history for this design, projected into the
 * shape RevisionStudio's existing timeline already draws. Same numbering, same
 * verbatim prompts, same timestamps and same master hashes PanelPro shows,
 * because both come from `loadDesignVersionHistory` and nothing else.
 */
export async function revisionStudioVersionCommits(generationId: string) {
  const history = await loadDesignVersionHistory(generationId);
  return versionCommitsFromHistory(history);
}
