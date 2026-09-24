/**
 * MY DESIGNS — every design this account owns, whichever tool made it.
 *
 * Owner, 2026-09-24: "Gallery is showing wallpro landing page. It should show a
 * MyDesigns Page and show my tagged designs from DesignProai VehiclePro,
 * WallPro, PatternPro, MyVehiclePro."
 *
 * ⚠️ THE MEASUREMENT THAT SHAPED THIS PAGE, so it is not re-derived and the
 * filter is not "completed" into a hardcoded list of four. Production,
 * 2026-09-24:
 *
 *   designpro_generation_requests   238   (VehiclePro)
 *   wallpro_generations              54   (WallPro)
 *   color_visualizations              0   (PatternPro / MyVehiclePro / ColorPro)
 *   vehicle_renders                   0
 *
 * PatternPro and MyVehiclePro have NO designs in this database. Their mode
 * labels exist because that vocabulary came across with the RestylePro code;
 * the rows never did. A chip for a tool with no rows is a dead end the customer
 * finds by tapping it, so the filter is built FROM THE ROWS THAT CAME BACK and
 * a new tool appears by itself the day it writes its first design.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  TOOL_LABELS, toolLabel, thumbnailOf, openPathOf, titleOf, toolsPresent, filterDesigns,
} from "../my-designs";

/** ⚠️ COMMENTS STRIPPED BEFORE JUDGING CODE. The page's own header explains
 *  that the file it replaced queried `supabase.from(...)` directly — so an
 *  assertion that the page contains no such call convicted the sentence saying
 *  it must not. That is the fourth time in this session a lock has matched its
 *  own prose; strip first, then judge. */
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const source = (rel: string) => strip(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));
const page = source("../../pages/MyDesigns.tsx");
const app = source("../../App.tsx");
const wallPro = source("../../pages/WallPro.tsx");
const nav = source("../dashboard-nav.ts");

const row = (over: Partial<any> = {}): any => ({
  id: "gen-1", render_urls: { side: "https://x/1.png" }, vehicle_year: "2022",
  vehicle_make: "Ford", vehicle_model: "F250", vehicle_type: "truck",
  design_file_name: "", color_name: null, color_hex: null, finish_type: null,
  mode_type: "designpanelpro", pipeline: null, created_at: "2026-09-20T00:00:00Z",
  updated_at: "2026-09-20T00:00:00Z", generation_status: "completed", admin_notes: null,
  custom_design_url: null, custom_swatch_url: null, design_id: "DID-1", order_number: "ORD-1",
  revision: 1, state: "outputs_ready", current_stage: "done", ...over,
});

describe("the page reads the two sources that have rows, and adds no third", () => {
  // RULE 0.21: one reader per artifact. RevisionStudioIQ merges exactly these
  // two through exactly this mapper; a third query over the same designs is a
  // second producer and the two would drift the first time either changed.
  it("uses RevisionStudio's own readers and WallPro's own row mapper", () => {
    expect(page).toContain("listRevisionStudioDesigns");
    expect(page).toContain("listWallDesignsForStudio");
    expect(page).toContain("wallStudioRow");
    // No direct table access: the customer-path seam gate forbids it on this
    // class of surface, and it is what made the page that was here before dead.
    expect(page).not.toContain("supabase.from(");
    expect(page).not.toContain("from('panel_designs')");
  });

  it("fails soft on WallPro, so a wall outage cannot hide the vehicle designs", () => {
    expect(page).toMatch(/listWallDesignsForStudio\(\)[\s\S]{0,80}\.catch\(\(\) => \[\]\)/);
  });
});

describe("the tool filter is built from the rows, never hardcoded", () => {
  it("offers only tools that actually returned a design", () => {
    const rows = [row({ mode_type: "designpanelpro" }), row({ id: "w1", mode_type: "wallpro" })];
    expect(toolsPresent(rows)).toEqual(["designpanelpro", "wallpro"]);
    // PatternPro is a real label and has zero rows in this database: it must
    // not be offered until one exists.
    expect(toolsPresent(rows)).not.toContain("patternpro");
    expect(TOOL_LABELS.patternpro).toBe("PatternPro");
  });

  it("puts the tool she used most recently first", () => {
    const rows = [
      row({ id: "a", mode_type: "designpanelpro", created_at: "2026-09-01T00:00:00Z" }),
      row({ id: "b", mode_type: "wallpro", created_at: "2026-09-22T00:00:00Z" }),
    ];
    expect(toolsPresent(rows)[0]).toBe("wallpro");
  });

  it("a new tool appears by itself, with no second change", () => {
    expect(toolsPresent([row({ mode_type: "patternpro" })])).toEqual(["patternpro"]);
  });

  it("ignores a row with no mode rather than inventing a chip for it", () => {
    expect(toolsPresent([row({ mode_type: "" }), row({ mode_type: null })])).toEqual([]);
  });
});

describe("a design opens where its own tool opens it", () => {
  it("sends a wall design to WallPro with its project, and everything else to RevisionStudio", () => {
    expect(openPathOf(row({ id: "proj-9", mode_type: "wallpro" }))).toBe("/printpro/wallpro?project=proj-9");
    expect(openPathOf(row({ id: "gen-9" }))).toBe("/revision-studio?id=gen-9");
  });

  it("escapes the id, so a design can never be a way to build a url", () => {
    expect(openPathOf(row({ id: "a/b?c=d" }))).toBe("/revision-studio?id=a%2Fb%3Fc%3Dd");
  });
});

describe("what a card says about a design", () => {
  it("names an unrecognised tool by its raw mode rather than a wrong label", () => {
    // A design filed under the WRONG tool is worse than one under an ugly name.
    expect(toolLabel("designpanelpro")).toBe("VehiclePro");
    expect(toolLabel("wallpro")).toBe("WallPro");
    expect(toolLabel("somethingnew")).toBe("somethingnew");
    expect(toolLabel(null)).toBe("Design");
  });

  it("prefers the tool's own name for the design, then the vehicle", () => {
    expect(titleOf(row({ design_file_name: "Arctic Air" }))).toBe("Arctic Air");
    expect(titleOf(row({ design_file_name: "  " }))).toBe("2022 Ford F250");
    expect(titleOf(row({ design_file_name: "", vehicle_year: "", vehicle_make: "", vehicle_model: "" })))
      .toBe("Untitled design");
  });

  it("takes the first real image and treats an empty string as no image", () => {
    expect(thumbnailOf(row())).toBe("https://x/1.png");
    expect(thumbnailOf(row({ render_urls: { side: "", hero: "https://x/2.png" } }))).toBe("https://x/2.png");
    expect(thumbnailOf(row({ render_urls: {} }))).toBeNull();
  });

  // The same phantom-row rule RevisionStudio's grid applies: a design with no
  // picture reads as a broken tile, not as a design.
  it("drops a row with no image before it can render as a broken tile", () => {
    expect(page).toContain("filter((row) => !!thumbnailOf(row))");
  });
});

describe("search narrows what is already loaded", () => {
  it("matches the name, the vehicle, the DesignID and the tool label", () => {
    // The wall row carries WALL identity, exactly as wallStudioRow builds it —
    // a fixture that left the truck's year/make/model on a wall design made
    // "f250" match both rows and the search case pass for the wrong reason.
    const wall = { mode_type: "wallpro", vehicle_year: null, vehicle_make: "WallPro", vehicle_model: "Fern wall", vehicle_type: "wall" };
    const rows = [row({ design_file_name: "Arctic Air" }), row({ id: "w", ...wall, design_file_name: "Fern wall", design_id: "DID-W" })];
    expect(filterDesigns(rows, "all", "arctic")).toHaveLength(1);
    expect(filterDesigns(rows, "all", "f250")).toHaveLength(1);
    expect(filterDesigns(rows, "all", "DID-W")).toHaveLength(1);
    expect(filterDesigns(rows, "all", "wallpro")).toHaveLength(1);
    expect(filterDesigns(rows, "all", "")).toHaveLength(2);
  });

  it("combines with the tool filter rather than replacing it", () => {
    const rows = [row({ design_file_name: "Fern truck" }), row({ id: "w", mode_type: "wallpro", vehicle_make: "WallPro", vehicle_model: "Fern wall", design_file_name: "Fern wall" })];
    expect(filterDesigns(rows, "wallpro", "fern")).toHaveLength(1);
    expect(filterDesigns(rows, "wallpro", "truck")).toHaveLength(0);
  });
});

describe("the page is reachable, which is the whole complaint", () => {
  // ⚠️ THE FILE THAT WAS HERE BEFORE HAD NO ROUTE AND QUERIED FOUR TABLES THAT
  // DO NOT EXIST IN THIS DATABASE (panel_designs, pattern_designs,
  // fadewrap_designs, custom_styling — all measured absent on 2026-09-24). It
  // was a RestylePro import, dead by construction. Built-and-unreachable is a
  // shape this repo has recorded many times; the route is half the fix.
  it("has a route, behind auth, and is not the public gallery", () => {
    expect(app).toContain('const MyDesigns = lazyWithRetry(() => import("./pages/MyDesigns"));');
    expect(app).toContain('<Route path="/my-designs" element={<RequireAuth><MyDesigns /></RequireAuth>} />');
    // /gallery is the PUBLIC showcase and stays exactly as it was.
    expect(app).toContain('<Route path="/gallery" element={<Gallery />} />');
  });

  it("is in the sidebar, above the public gallery", () => {
    expect(nav).toContain('route: "/my-designs"');
    expect(nav.indexOf('key: "my-designs"')).toBeLessThan(nav.indexOf('key: "gallery"'));
  });

  // Owner: "Gallery is showing wallpro landing page." On DesignProAI that link
  // now opens My Designs and says so; on WePrintWraps it stays the marketing
  // examples, because that brand's visitors have no account and a sign-in wall
  // would be worse than the defect being fixed.
  it("repoints the WallPro header link that was reported, and renames it", () => {
    expect(wallPro).toContain('<Link to="/my-designs" className="wallpro-header-link hidden lg:inline-flex">My Designs</Link>');
    expect(wallPro).toContain('<Link to="/wall-wrap#examples" className="wallpro-header-link hidden lg:inline-flex">Gallery</Link>');
    // The old both-brands link to the landing page is gone, not merely unused.
    expect(wallPro).not.toContain("'/wallpro') + '#examples'");
  });
});
