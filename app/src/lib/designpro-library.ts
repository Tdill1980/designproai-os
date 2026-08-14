/**
 * The design library, served from canonical standalone objects.
 *
 * RevisionStudioIQ's grid, and everything downstream of a selected design, was
 * written against `color_visualizations` rows. That table is legacy RestylePro
 * storage which the standalone runtime contract prohibits, and projecting
 * generations into it to satisfy the original UI was the wrong half of the
 * migration to keep — the schema tests caught it as "blocked table
 * synthesized".
 *
 * So the row is BUILT here rather than stored: the gateway lists the caller's
 * generations from designpro_generation_requests, listGenerationViews signs the
 * views for one of them, and this module shapes both into the record the
 * original UI already knows how to render. Nothing durable is written anywhere.
 *
 * This is a read adapter, deliberately. It changes no product behaviour, adds
 * no surface, and can be deleted the day the UI reads generations natively.
 */
import { dpApi, type GenerationSummary } from "@/lib/designpro-api";

/**
 * The product's view vocabulary. `source_view_type` already IS the product's
 * key for the six flat views; only the hero differs, and the mapping is
 * explicit in both directions so no caller has to guess.
 */
const PRODUCT_VIEW_KEY: Record<string, string> = {
  side: "side",
  "passenger-side": "passenger-side",
  hood_detail: "hood_detail",
  roof: "roof",
  front: "front",
  rear: "rear",
  "hero-3d": "hero",
};

/** The library row shape the original UI consumes. */
export type LibraryRender = {
  id: string;
  request_id: string;
  generation_id: string;
  customer_email: string | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_type: string | null;
  mode_type: string;
  design_file_name: string | null;
  color_name: string | null;
  color_hex: string;
  finish_type: string;
  custom_styling_prompt_key: string | null;
  render_urls: Record<string, string>;
  generation_status: string;
  created_at: string | null;
  updated_at: string | null;
  admin_notes: string;
  order_number: string | null;
  is_saved: true;
  custom_design_url: string | null;
  custom_swatch_url: string | null;
  organization_id: null;
  subscription_tier: null;
  infusion_color_id: null;
  lineage_root_id: null;
  uses_custom_design: false;
};

function toRow(summary: GenerationSummary, renderUrls: Record<string, string>): LibraryRender {
  const vehicle = summary.vehicle || {};
  const year = Number.parseInt(String(vehicle.year ?? "").replace(/\D/g, ""), 10);
  const name = summary.designName || summary.orderNumber || `DesignPro ${summary.generationId.slice(0, 8)}`;
  const hero = renderUrls.side || renderUrls.hero || null;

  // admin_notes is JSON text in the product's schema, and several surfaces parse
  // it for the linked generation id. Carry the same keys so those keep working.
  const notes = JSON.stringify({
    designiq_generation_id: summary.generationId,
    designpro_generation_id: summary.generationId,
    designpro_request_id: summary.requestId,
    source: "designpro.calls-1-7",
    designiq_mode: summary.businessName ? "commercial" : "restyle",
    vehicle_type: vehicle.type || null,
    original_prompt: summary.brief || null,
    company_name: summary.businessName || null,
    order_number: summary.orderNumber || null,
  });

  return {
    // The generation id is the design's identity everywhere else in this system,
    // so it is the row id too rather than a second identifier that can drift.
    id: summary.generationId,
    request_id: summary.requestId,
    generation_id: summary.generationId,
    customer_email: null,
    vehicle_year: Number.isFinite(year) ? year : null,
    vehicle_make: (vehicle.make || "").trim().toLowerCase() || null,
    vehicle_model: (vehicle.model || "").trim().toLowerCase() || null,
    vehicle_type: (vehicle.type || "").trim().toLowerCase() || null,
    mode_type: "designpanelpro",
    design_file_name: name,
    color_name: name,
    color_hex: "#000000",
    finish_type: (summary.finish || "gloss").toLowerCase(),
    custom_styling_prompt_key: summary.brief || null,
    render_urls: renderUrls,
    generation_status: "completed",
    created_at: summary.createdAt,
    updated_at: summary.completedAt || summary.createdAt,
    admin_notes: notes,
    order_number: summary.orderNumber,
    is_saved: true,
    custom_design_url: hero,
    custom_swatch_url: hero,
    organization_id: null,
    subscription_tier: null,
    infusion_color_id: null,
    lineage_root_id: null,
    uses_custom_design: false,
  };
}

/**
 * Signed view URLs for one generation, keyed by the product's view vocabulary.
 *
 * A view the gateway could not sign is omitted rather than carried as a broken
 * source: the product already treats a missing key as "this view isn't ready",
 * which is exactly what an unsignable view means.
 */
export async function renderUrlsFor(requestId: string): Promise<Record<string, string>> {
  const urls: Record<string, string> = {};
  for (const view of await dpApi.listGenerationViews(requestId)) {
    const key = PRODUCT_VIEW_KEY[view.sourceViewType];
    if (key && view.signedUrl) urls[key] = view.signedUrl;
  }
  return urls;
}

/**
 * The caller's design library.
 *
 * Only generations whose outputs are ready appear: a generation still running is
 * a job in progress, not a design the customer owns, and the product's grid has
 * always shown finished work. Generations whose views cannot be signed right now
 * are dropped rather than rendered as empty cards.
 */
export async function listLibrary(): Promise<LibraryRender[]> {
  const summaries = (await dpApi.listGenerationRequests())
    .filter((s) => ["outputs_ready", "handoff_ready", "completed"].includes(s.state));

  const rows = await Promise.all(summaries.map(async (summary) => {
    try {
      const renderUrls = await renderUrlsFor(summary.requestId);
      if (!Object.keys(renderUrls).length) return null;
      return toRow(summary, renderUrls);
    } catch (err) {
      console.warn("[DesignPro] could not resolve views for", summary.requestId, err);
      return null;
    }
  }));

  return rows.filter((row): row is LibraryRender => row !== null);
}
