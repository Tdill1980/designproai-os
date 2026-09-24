/**
 * MY DESIGNS — every design this account owns, whichever tool made it.
 *
 * Owner, 2026-09-24: "Gallery is showing wallpro landing page. It should show a
 * MyDesigns Page and show my tagged designs from DesignProai VehiclePro,
 * WallPro, PatternPro, MyVehiclePro."
 *
 * ── WHAT WAS HERE BEFORE, AND WHY IT IS GONE ──────────────────────────────
 *
 * A 426-line RestylePro import with NO ROUTE, querying `panel_designs`,
 * `pattern_designs`, `fadewrap_designs` and `custom_styling` directly through
 * `supabase.from(...)`. Measured on production, 2026-09-24: none of those four
 * tables EXISTS in this database. Routing it would have shipped a page that
 * throws, and it also bypassed `dpApi`, which the customer-path seam gate
 * forbids for exactly this class of surface. The reference implementation lives
 * in `restylepro-os` where RULE 1 says to read it, not in a dead file here.
 *
 * ── THE SOURCES ARE THE ONES THAT HAVE ROWS, AND NOTHING IS INVENTED ──────
 *
 * Measured the same day, on production:
 *
 *   designpro_generation_requests   238   (VehiclePro — 105 outputs_ready)
 *   wallpro_generations              54   (WallPro)
 *   color_visualizations              0   (PatternPro / MyVehiclePro / ColorPro)
 *   vehicle_renders                   0
 *
 * So PatternPro and MyVehiclePro have NO designs in this database at all. Their
 * mode labels exist in the UI (`myvehicle_colorpro`, …) because that vocabulary
 * came across with the RestylePro code; the rows never did. Shipping tabs for
 * them would be shipping two filters that can never match anything.
 *
 * The filter is therefore built FROM THE ROWS THAT CAME BACK. The day PatternPro
 * writes its first design it appears here by itself, with no second change and
 * nothing to remember — which is the honest way to "support" a source that does
 * not exist yet.
 *
 * ── ONE READER PER ARTIFACT (RULE 0.21) ───────────────────────────────────
 *
 * `listRevisionStudioDesigns` and `listWallDesignsForStudio` are the SAME two
 * readers RevisionStudioIQ merges, mapped through the SAME `wallStudioRow`. A
 * third query over these designs is a second producer of one list, and the two
 * would drift the first time either product changed shape. This page is a
 * consumer; the editor is a consumer; neither owns the data.
 *
 * WallPro fails soft to an empty set, exactly as it does in RevisionStudio: a
 * wall outage must not hide the vehicle designs.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ImageOff, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listRevisionStudioDesigns, type RevisionStudioDesignRow } from "@/lib/revisionstudio-source";
import { toolLabel, thumbnailOf, openPathOf, titleOf, toolsPresent, filterDesigns } from "@/lib/my-designs";
import { listWallDesignsForStudio } from "@/lib/wallpro-api";
import { wallStudioRow } from "@/lib/wallpro-studio";

async function loadMyDesigns(): Promise<RevisionStudioDesignRow[]> {
  const [vehicle, walls] = await Promise.all([
    listRevisionStudioDesigns(),
    listWallDesignsForStudio().then((rows) => rows.map(wallStudioRow)).catch(() => []),
  ]);
  return [...vehicle, ...walls]
    .filter((row) => !!thumbnailOf(row))
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
}

export default function MyDesigns() {
  const [tool, setTool] = useState("all");
  const [search, setSearch] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["my-designs"],
    queryFn: loadMyDesigns,
    staleTime: 30_000,
  });

  const rows = useMemo(() => data ?? [], [data]);
  const tools = useMemo(() => toolsPresent(rows), [rows]);
  const shown = useMemo(() => filterDesigns(rows, tool, search), [rows, tool, search]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8">
      <header className="mb-5">
        <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">My Designs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every design on this account, newest first. Open one to revise it or order its print files.
        </p>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button size="sm" variant={tool === "all" ? "default" : "outline"} onClick={() => setTool("all")}>
          All{rows.length ? ` · ${rows.length}` : ""}
        </Button>
        {tools.map((key) => (
          <Button key={key} size="sm" variant={tool === key ? "default" : "outline"} onClick={() => setTool(key)}>
            {toolLabel(key)}
          </Button>
        ))}
        <label className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            className="h-9 w-48 rounded-md border bg-background pl-8 pr-2 text-sm sm:w-64"
            placeholder="Search designs"
            aria-label="Search designs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>

      {isLoading && (
        <p className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />Loading your designs…
        </p>
      )}

      {/* An error says what failed and offers the tools, rather than an empty
          grid that reads as "you have no designs" — which is the same lie the
          expired-thumbnail grid told on 2026-09-23. */}
      {!isLoading && error && (
        <div className="rounded-xl border border-amber-500 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">Your designs could not be loaded.</p>
          <p className="mt-1">{error instanceof Error ? error.message : "Try again in a moment."}</p>
        </div>
      )}

      {!isLoading && !error && !rows.length && (
        <div className="rounded-xl border p-8 text-center">
          <ImageOff className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 font-semibold">No designs yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Designs you create in VehiclePro and WallPro appear here.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button asChild size="sm"><Link to="/designpro/create">Design a vehicle</Link></Button>
            <Button asChild size="sm" variant="outline"><Link to="/printpro/wallpro">Design a wall</Link></Button>
          </div>
        </div>
      )}

      {!isLoading && !error && !!rows.length && !shown.length && (
        <p className="py-12 text-center text-sm text-muted-foreground">No designs match that search.</p>
      )}

      {!!shown.length && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((row) => {
            const src = thumbnailOf(row);
            return (
              <li key={row.mode_type + ":" + row.id} className="overflow-hidden rounded-xl border">
                <Link to={openPathOf(row)} className="block">
                  <div className="relative aspect-[4/3] overflow-hidden bg-muted">
                    {src && <img src={src} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" loading="lazy" />}
                    <span className="absolute left-2 top-2 rounded-full bg-slate-900/75 px-2 py-0.5 text-[11px] font-bold text-white">
                      {toolLabel(row.mode_type)}
                    </span>
                  </div>
                  <div className="p-2.5">
                    <p className="truncate text-sm font-semibold">{titleOf(row)}</p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {row.design_id || row.order_number || ""}
                      {row.created_at ? ` · ${new Date(row.created_at).toLocaleDateString()}` : ""}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
