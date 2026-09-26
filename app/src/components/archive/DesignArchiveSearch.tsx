/**
 * FIND ANY DESIGN: order #, customer, vehicle make/model/year, date, status, year.
 *
 * Reads `GET /api/designs/search` (migration 20260926010000). The database's RLS
 * decides the scope: a customer searches their own designs, PanelPro QC staff
 * search the whole archive, with the same component. Keyset-paged ("Load more"),
 * so the 10,000th design is as reachable as the first.
 */
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dpApi, type DesignArchiveSearchFilters } from "@/lib/designpro-api";

const STATUSES = ["", "generating", "ready", "failed", "ordered", "in_production", "delivered", "archived"] as const;
const EMPTY: DesignArchiveSearchFilters = { q: "", order: "", make: "", model: "", year: "", createdYear: "", from: "", to: "", status: "" };

export function DesignArchiveSearch() {
  const [draft, setDraft] = useState<DesignArchiveSearchFilters>(EMPTY);
  const [filters, setFilters] = useState<DesignArchiveSearchFilters>(EMPTY);
  const query = useInfiniteQuery({
    queryKey: ["design-archive-search", filters],
    queryFn: ({ pageParam }) => dpApi.searchDesignArchive({
      ...filters,
      // Dates are whole days in the user's own calendar.
      from: filters.from ? new Date(`${filters.from}T00:00:00`).toISOString() : "",
      to: filters.to ? new Date(`${filters.to}T23:59:59.999`).toISOString() : "",
      limit: 24,
      ...(pageParam || {}),
    }),
    initialPageParam: null as null | { cursorAt: string; cursorId: string },
    getNextPageParam: (last) => last.nextCursor,
  });
  const designs = query.data?.pages.flatMap((page) => page.designs) ?? [];
  const set = (key: keyof DesignArchiveSearchFilters) => (e: { target: { value: string } }) =>
    setDraft((current) => ({ ...current, [key]: e.target.value }));
  const submit = (e: FormEvent) => { e.preventDefault(); setFilters(draft); };
  const field = "h-9 rounded-md border bg-background px-2 text-sm";

  return (
    <section aria-label="Search the design archive" className="mb-6 rounded-xl border p-4">
      <form onSubmit={submit} className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-5">
        <input className={`${field} col-span-2`} placeholder="Customer, design name or DID" aria-label="Customer, design name or DID" value={String(draft.q || "")} onChange={set("q")} />
        <input className={field} placeholder="Order #" aria-label="Order number" value={String(draft.order || "")} onChange={set("order")} />
        <input className={field} placeholder="Make" aria-label="Vehicle make" value={String(draft.make || "")} onChange={set("make")} />
        <input className={field} placeholder="Model" aria-label="Vehicle model" value={String(draft.model || "")} onChange={set("model")} />
        <input className={field} placeholder="Vehicle year" aria-label="Vehicle year" inputMode="numeric" value={String(draft.year || "")} onChange={set("year")} />
        <input className={field} placeholder="Created in (year)" aria-label="Year created" inputMode="numeric" value={String(draft.createdYear || "")} onChange={set("createdYear")} />
        <input className={field} type="date" aria-label="Created from" value={String(draft.from || "")} onChange={set("from")} />
        <input className={field} type="date" aria-label="Created to" value={String(draft.to || "")} onChange={set("to")} />
        <select className={field} aria-label="Status" value={String(draft.status || "")} onChange={set("status")}>
          {STATUSES.map((s) => <option key={s} value={s}>{s ? s.replace("_", " ") : "Any status"}</option>)}
        </select>
        <div className="col-span-2 flex gap-2 md:col-span-4 lg:col-span-5">
          <Button type="submit" size="sm"><Search className="mr-1.5 h-4 w-4" />Search</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => { setDraft(EMPTY); setFilters(EMPTY); }}>Clear</Button>
        </div>
      </form>

      {query.isPending && <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Searching…</p>}
      {query.isError && <p className="mt-4 text-sm text-amber-700">The archive search is unavailable right now.</p>}
      {!query.isPending && !query.isError && !designs.length && <p className="mt-4 text-sm text-muted-foreground">No designs match.</p>}
      {!!designs.length && (
        <ul className="mt-4 divide-y rounded-lg border">
          {designs.map((d) => (
            <li key={d.designId}>
              <Link to={`/revision-studio?id=${encodeURIComponent(d.generationId)}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 hover:bg-muted/50">
                <span className="font-mono text-xs">{d.designId}</span>
                <span className="text-sm font-semibold">{d.companyName || d.designName || "Untitled design"}</span>
                <span className="text-xs text-muted-foreground">{[d.vehicle.year, d.vehicle.make, d.vehicle.model].filter(Boolean).join(" ")}</span>
                {d.orderNumbers.length ? <span className="text-xs">Order #{d.orderNumbers.join(", #")}</span> : null}
                <span className="ml-auto text-xs text-muted-foreground">
                  {d.status.replace("_", " ")}{d.currentRevisionSequence ? ` · V${d.currentRevisionSequence}` : ""}
                  {d.createdAt ? ` · ${new Date(d.createdAt).toLocaleDateString()}` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {query.hasNextPage && (
        <Button className="mt-3" size="sm" variant="outline" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
          {query.isFetchingNextPage ? "Loading…" : "Load more"}
        </Button>
      )}
    </section>
  );
}
