import {
  SURFACE_LABEL,
  type FlatAtlasPanelMapEntry,
} from "@/lib/designpro-api";
import { cn } from "@/lib/utils";

function inches(value: number): string {
  return `${Number(value).toFixed(1)}\u2033`;
}

export function FlatAtlasPanelSchedule({
  panels,
  className,
}: {
  panels: FlatAtlasPanelMapEntry[] | undefined;
  className?: string;
}) {
  if (!panels?.length) {
    return (
      <div className={cn("rounded-lg border border-border/70 bg-muted/20 p-3 text-xs text-muted-foreground", className)}>
        The six-panel dimension schedule is still being resolved from the A.T.L.A.S. manifest.
      </div>
    );
  }

  const totalTrimSqFt = panels.reduce((total, panel) => total + Number(panel.surfaceSqFt), 0);
  const totalPrintSqFt = panels.reduce(
    (total, panel) => total + Number(panel.printWidthIn) * Number(panel.printHeightIn) / 144,
    0,
  );

  return (
    <div className={cn("overflow-hidden rounded-lg border border-border/70", className)}>
      <div className="border-b border-border/70 bg-muted/30 px-3 py-2">
        <p className="text-xs font-semibold">Six production panels</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          Print size includes 5″ bleed on every edge. These values are a diagnostic schedule; this test does not publish print files.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[650px] text-left text-[11px]">
          <thead className="bg-muted/20 text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-semibold">Surface</th>
              <th className="px-3 py-2 font-semibold">Trim W × H</th>
              <th className="px-3 py-2 font-semibold">Print W × H</th>
              <th className="px-3 py-2 text-right font-semibold">Trim sq ft</th>
              <th className="px-3 py-2 text-right font-semibold">Effective PPI</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {panels.map((panel) => (
              <tr key={panel.surfaceKey}>
                <td className="whitespace-nowrap px-3 py-2 font-medium">
                  {SURFACE_LABEL[panel.surfaceKey] || panel.surfaceKey}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                  {inches(panel.trimWidthIn)} × {inches(panel.trimHeightIn)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                  {inches(panel.printWidthIn)} × {inches(panel.printHeightIn)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {Number(panel.surfaceSqFt).toFixed(1)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {Math.round(Number(panel.effectivePpi))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border/70 bg-muted/20 px-3 py-2 text-[10px] text-muted-foreground">
        <span>Total trim: {totalTrimSqFt.toFixed(1)} sq ft</span>
        <span>Total including bleed: {totalPrintSqFt.toFixed(1)} sq ft</span>
      </div>
    </div>
  );
}
