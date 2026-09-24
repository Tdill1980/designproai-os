/**
 * MY DESIGNS — the pure half.
 *
 * Every rule this page applies to a design list lives here, with no React, no
 * Supabase and no page imports, so it is testable without a browser. That is
 * this repo's own convention (`wallpro-ai-view.ts`: "Pure: no React, no
 * Supabase, so the policy is testable without a browser") and it is not
 * decoration: importing the PAGE pulls in `revisionstudio-source` ->
 * `designpro-api` -> the Supabase client, which reads `localStorage` at module
 * load and throws under the node test environment. A lock that cannot import
 * what it locks ends up asserting source text instead of behaviour.
 */
import type { RevisionStudioDesignRow } from "@/lib/revisionstudio-source";
import { wallProjectPath, WALL_MODE } from "@/lib/wallpro-studio";

/** The customer-facing name of the tool that made a design.
 *
 * Keyed on `mode_type`, which is a STORED value and the same key
 * RevisionStudioIQ badges from. Anything unrecognised keeps its raw mode rather
 * than being folded into a wrong label — a design filed under the wrong tool is
 * worse than one filed under an ugly name. */
export const TOOL_LABELS: Record<string, string> = {
  designpanelpro: "VehiclePro",
  designpro: "VehiclePro",
  wallpro: "WallPro",
  graphicspro: "CutPro",
  GraphicsPro: "CutPro",
  patternpro: "PatternPro",
  recreatepro: "RecreatePro",
  colorpro: "ColorPro",
  ColorPro: "ColorPro",
  inkfusion: "ColorPro",
  myvehicle_colorpro: "MyVehiclePro",
  myvehicle_designpanelpro: "MyVehiclePro",
  myvehicle_fadewraps: "MyVehiclePro",
  myvehicle_graphicspro: "MyVehiclePro",
  myvehicle_deploy: "MyVehiclePro",
};

export function toolLabel(modeType: string | null | undefined): string {
  const key = String(modeType || "").trim();
  return TOOL_LABELS[key] || key || "Design";
}

/** The first real image on a row. A card without one is not shown at all —
 *  the same phantom-row rule RevisionStudio's grid applies, because a design
 *  with no picture reads as a broken tile rather than as a design. */
export function thumbnailOf(row: RevisionStudioDesignRow): string | null {
  for (const value of Object.values(row.render_urls || {})) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

/** Where this design reopens, by the tool that made it. A wall design opens in
 *  WallPro with its photo, versions and panels; everything else opens in
 *  RevisionStudio on its own id, which is the deep link that page already
 *  reads (`?id=`). */
export function openPathOf(row: RevisionStudioDesignRow): string {
  if (row.mode_type === WALL_MODE) return wallProjectPath(row.id);
  return "/revision-studio?id=" + encodeURIComponent(row.id);
}

/** What a card calls this design. `design_file_name` is the tool's own name for
 *  it; the vehicle fields are the fallback for a row that never got one. */
export function titleOf(row: RevisionStudioDesignRow): string {
  const named = String(row.design_file_name || "").trim();
  if (named) return named;
  const vehicle = [row.vehicle_year, row.vehicle_make, row.vehicle_model]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");
  return vehicle || "Untitled design";
}

/**
 * The tools to offer as filters: the ones that actually returned designs,
 * newest-first by their own most recent design so the tool she used last is
 * the first chip after All.
 *
 * ⚠️ NEVER A HARDCODED LIST. That is the whole finding above — two of the four
 * tools named in the request have zero rows in this database, and a chip that
 * can never match anything is a dead end the customer has to discover by
 * tapping it.
 */
export function toolsPresent(rows: RevisionStudioDesignRow[]): string[] {
  const seen = new Map<string, string>();
  for (const row of rows) {
    const key = String(row.mode_type || "").trim();
    if (!key) continue;
    if (!seen.has(key)) seen.set(key, String(row.created_at || ""));
  }
  return [...seen.entries()]
    .sort((a, b) => b[1].localeCompare(a[1]))
    .map(([key]) => key);
}

export function filterDesigns(
  rows: RevisionStudioDesignRow[],
  tool: string,
  search: string,
): RevisionStudioDesignRow[] {
  const needle = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (tool !== "all" && String(row.mode_type || "") !== tool) return false;
    if (!needle) return true;
    return [
      row.design_file_name, row.vehicle_year, row.vehicle_make, row.vehicle_model,
      row.design_id, row.order_number, toolLabel(row.mode_type),
    ].some((field) => String(field || "").toLowerCase().includes(needle));
  });
}
