/**
 * THE FULL VERSION HISTORY — every version, every prompt, every asset, in order.
 *
 * Mounted through `DesignPromptRecord`, which RevisionStudioIQ, PanelPro Studio
 * (AdminGeminiCompareStudio) and the PanelPro board all already render, so all
 * three read the same record from the same route. The customer's copy is
 * stripped of the A.T.L.A.S. master by the database (`audience: "customer"`);
 * this component draws what it is given and never asks for more.
 *
 * NOT A PRODUCER. It reads; it never starts, repeats or edits a generation.
 */
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { dpApi } from "@/lib/designpro-api";
import { exactTimestamp } from "@/lib/design-version-history";
import { archiveTimeline, designIdForGeneration, formatBytes, PROMPT_KIND_LABEL } from "@/lib/design-archive";

const SURFACE_LABEL: Record<string, string> = {
  side: "Driver side", "passenger-side": "Passenger side", hood_detail: "Hood", front: "Front",
  rear: "Rear", roof: "Roof", "close-up": "Close-up", driver: "Driver panel", passenger: "Passenger panel",
  hood: "Hood panel",
};
const label = (surface: string | null) => (surface ? SURFACE_LABEL[surface] || surface : "");

export function DesignFullHistory({ generationId, fallback = null }: { generationId: string; fallback?: ReactNode }) {
  const designId = designIdForGeneration(generationId);
  const { data, isPending, isError } = useQuery({
    queryKey: ["design-archive-history", designId],
    queryFn: () => dpApi.getDesignArchiveHistory(designId),
    enabled: Boolean(designId),
    refetchInterval: 15_000,
  });
  if (!designId) return null;
  if (isPending) return <p className="p-3 text-xs text-muted-foreground">Loading the full design history…</p>;
  // Not indexed yet, archive off on the server, or no access: show the record
  // that already works rather than an empty panel that reads as "no history".
  if (isError || !data) return <>{fallback}</>;

  const timeline = archiveTimeline(data);
  const staff = data.audience === "staff";
  return (
    <section aria-label="Full design history" className="space-y-3 rounded-lg border border-border bg-card p-4 text-card-foreground">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Full design history</h3>
        <span className="text-[11px] text-muted-foreground">
          {data.versions.length} version{data.versions.length === 1 ? "" : "s"} · {data.prompts.length} prompt{data.prompts.length === 1 ? "" : "s"} · {data.files.length} file{data.files.length === 1 ? "" : "s"}
          {staff ? " · QC view" : ""}
        </span>
      </header>
      <dl className="grid gap-2 text-xs sm:grid-cols-3">
        <div><dt className="text-muted-foreground">Design ID</dt><dd className="font-mono">{data.designId}</dd></div>
        <div><dt className="text-muted-foreground">Generation ID</dt><dd className="break-all font-mono">{data.generationId}</dd></div>
        <div><dt className="text-muted-foreground">Order #</dt><dd className="font-mono">{data.orders.map((o) => o.orderNumber).join(", ") || "— not linked"}</dd></div>
      </dl>
      <ol className="space-y-1.5" aria-label="Every version, prompt, file and order, in order">
        {timeline.map((entry, index) => {
          const key = `${entry.type}:${index}`;
          if (entry.type === "prompt") {
            const p = entry.prompt;
            return (
              <li key={key} className="rounded-md border border-border p-2.5 text-xs">
                <div className="flex flex-wrap justify-between gap-2">
                  <strong>{PROMPT_KIND_LABEL[p.kind]} · V{p.version}{p.surface ? ` · ${label(p.surface)}` : ""}</strong>
                  <span className="text-muted-foreground">{p.state || ""}</span>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap break-words text-sm">{p.prompt ?? "No text was recorded."}</p>
                <p className="mt-1 text-muted-foreground">{exactTimestamp(p.createdAt)}</p>
              </li>
            );
          }
          if (entry.type === "version") {
            const v = entry.record;
            return (
              <li key={key} className="rounded-md border border-blue-500/40 bg-blue-500/5 p-2.5 text-xs">
                <strong>V{v.version} saved</strong>
                <span className="ml-2 text-muted-foreground">{exactTimestamp(v.createdAt)}</span>
                {staff && (
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                    {v.widthPx && v.heightPx ? `${v.widthPx}×${v.heightPx}px · ` : ""}
                    {v.effectivePpi !== null && v.effectivePpi !== undefined ? `${v.effectivePpi} PPI · ` : ""}
                    {v.productionEligible ? "production-eligible" : "not production-eligible"}
                    {v.promptVersion ? ` · prompt ${v.promptVersion}` : ""}
                    {v.masterContentHash ? ` · master ${v.masterContentHash.slice(0, 12)}…` : ""}
                  </p>
                )}
              </li>
            );
          }
          if (entry.type === "file") {
            const f = entry.file;
            return (
              <li key={key} className="flex flex-wrap items-center gap-x-2 rounded-md px-2.5 py-1 text-[11px] text-muted-foreground">
                <span className="font-semibold text-foreground">{f.kind}{f.surface ? ` · ${label(f.surface)}` : ""}</span>
                {f.version ? <span>V{f.version}</span> : null}
                {f.widthPx && f.heightPx ? <span>{f.widthPx}×{f.heightPx}px</span> : null}
                {formatBytes(f.byteSize) ? <span>{formatBytes(f.byteSize)}</span> : null}
                {f.superseded ? <span className="text-amber-600">superseded</span> : null}
                <span className="ml-auto">{exactTimestamp(f.createdAt)}</span>
                {staff && f.storagePath ? <span className="w-full break-all font-mono text-[10px]">{f.storagePath}</span> : null}
              </li>
            );
          }
          return (
            <li key={key} className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-2.5 text-xs">
              <strong>Order #{entry.order.orderNumber}</strong>
              <span className="ml-2 text-muted-foreground">{entry.order.source} · {exactTimestamp(entry.order.boundAt)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
