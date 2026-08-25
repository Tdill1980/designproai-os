/**
 * The server-owned source behind RevisionStudioIQ's design grid.
 *
 * RevisionStudioIQ is the migrated product UI and stays exactly as it is. What
 * changed underneath it is where a design row comes from: it used to be a
 * `color_visualizations` select, which is a RestylePro table that holds zero
 * rows in DesignProAI and is on the customer-path seam gate's forbidden list.
 * The designs live in the server-owned run tables now, reachable only through
 * `dpApi`.
 *
 * So this adapter returns rows carrying the SAME field names the grid already
 * reads -- `id`, `render_urls`, `vehicle_make`, `design_file_name`,
 * `finish_type` and the rest -- assembled from `dpApi`. That is deliberate: it
 * keeps the port to the data seam and leaves every one of the page's ~9,800
 * lines of layout, cards, GalleryMode, search and actions untouched. A field
 * the server genuinely does not have is null, never a placeholder, because a
 * card that invents a vehicle is worse than a card that omits one.
 */
import {
  dpApi,
  ROLE_FOR_SOURCE_VIEW_TYPE,
  type ApprovedGenerationView,
  type WorkflowStatus,
} from "@/lib/designpro-api";

/**
 * One design as the grid consumes it. The names are the legacy column names on
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
 */
export function renderUrlsFromViews(views: readonly ApprovedGenerationView[]): Record<string, string> {
  const urls: Record<string, string> = {};
  for (const view of views) {
    const role = ROLE_FOR_SOURCE_VIEW_TYPE[view.sourceViewType];
    if (!role || !view.signedUrl) continue;
    urls[role] = view.signedUrl;
  }
  return urls;
}

/** Project one server job into the row shape the existing grid reads. */
export function designRowFromJob(
  job: WorkflowStatus,
  views: readonly ApprovedGenerationView[],
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
    design_id: job.designId,
    order_number: job.orderNumber,
    revision: job.revision,
    state: job.state,
    current_stage: job.currentStage,
  };
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
      // A run whose views cannot be read is still a real design and still gets
      // a card; it simply shows no preview yet. Dropping it would make a design
      // disappear from the customer's own studio because one signed URL failed.
      const views = await dpApi.listApprovedViews(job.generationId).catch(() => []);
      return designRowFromJob(job, views);
    }),
  );
  return rows.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
}
