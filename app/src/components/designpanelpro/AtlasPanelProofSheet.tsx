import { useQuery } from "@tanstack/react-query";
import type { AtlasPanelProof, PanelProofPanel } from "@/lib/designpro-api";

/**
 * THE THREE-ZONE PRODUCTION PANEL PROOF, SHOWN AS SOON AS IT EXISTS.
 *
 * Owner, on the architecture: "Production panel proof is source it has the 3
 * zones / For panels, panels with seperated and logos and text."
 *
 * The sheet Call 1 draws IS the source: Zone 1 is cut and placed into the GENIE
 * manifest and becomes the accepted master, Zone 2 is the same six panels with
 * no type or logos, Zone 3 is the five cut graphics. All three were being
 * produced and stored and none of them could be seen — the product showed the
 * assembled master and nothing of the document it came from.
 *
 * Three things this component deliberately does NOT do:
 *
 * 1. It never calls a raster crop an editable layer or a vector cut file. Zone
 *    3 is a raster of drawn marks; the plotter-ready contour is produced by the
 *    cut-contour builder downstream, and saying otherwise here would promise a
 *    file that does not exist yet.
 * 2. It never shows a gap for an unstored panel. The quadrant write fails soft
 *    by contract (Zone 1 is already an accepted master, and an optional sibling
 *    may not take a good design down), so a measured-but-unstored panel is
 *    labelled with its reason.
 * 3. It never prints a dimension that does not exist. A Zone 3 slot has no
 *    inches — it is sized at the plotter — so null stays blank rather than
 *    becoming 0".
 */

const ZONES: Array<{
  key: "branded" | "clean" | "cutGraphics";
  title: string;
  blurb: string;
}> = [
  {
    key: "branded",
    title: "Zone 1 — print panels",
    blurb: "Cut to your vehicle's GENIE dimensions with the 5\" bleed and placed into the master. These are what get printed.",
  },
  {
    key: "clean",
    title: "Zone 2 — panels without type or logos",
    blurb: "The same six panels with the lettering and marks left off, for laying on a vehicle template during sizing QC.",
  },
  {
    key: "cutGraphics",
    title: "Zone 3 — logo, text and graphic elements",
    blurb: "Original brand assets and outlined text are kept separate from the backgrounds. Plotter-ready contours are validated in the production pack.",
  },
];

const CUT_SLOT_LABEL: Record<string, string> = {
  logo: "Primary logo",
  typography: "Outlined brand text",
  tagline: "Tagline / slogan",
  contact: "Contact line",
  promo: "Promotional text",
  icons: "Icons / service graphics",
};

function panelLabel(panel: PanelProofPanel): string {
  if (panel.role === "cut-graphic") return CUT_SLOT_LABEL[panel.surfaceKey] || panel.surfaceKey;
  return panel.surfaceKey.charAt(0).toUpperCase() + panel.surfaceKey.slice(1);
}

/** Inches, or nothing. A cut graphic has no inches and must not read as 0". */
function inches(panel: PanelProofPanel): string | null {
  if (panel.widthIn === null || panel.heightIn === null) return null;
  return `${panel.widthIn}" × ${panel.heightIn}"`;
}

function PanelCard({ panel }: { panel: PanelProofPanel }) {
  const size = inches(panel);
  return (
    <li className="rounded-lg border border-gray-200 bg-white p-2 flex flex-col gap-1">
      {panel.signedUrl ? (
        <a href={panel.signedUrl} target="_blank" rel="noreferrer" className="block">
          <img
            src={panel.signedUrl}
            alt={panelLabel(panel)}
            className="w-full max-h-40 object-contain bg-gray-50 rounded"
            loading="lazy"
          />
        </a>
      ) : (
        <div className="w-full h-20 flex items-center justify-center rounded bg-gray-50 text-[11px] text-gray-500 text-center px-2">
          {/* Honest about WHICH of the two absences this is. */}
          {panel.persisted === false
            ? `Cut and measured, not saved — ${panel.reason || "reason not recorded"}`
            : panel.role === "branded"
              ? "Shown on the master sheet above"
              : "Preview not available"}
        </div>
      )}
      <p className="text-xs font-semibold text-gray-900">{panelLabel(panel)}</p>
      {size && <p className="text-[11px] text-gray-500">{size}</p>}
    </li>
  );
}

export function AtlasPanelProofSheet({
  proof,
  status,
}: {
  proof: AtlasPanelProof | undefined;
  status: "pending" | "error" | "success";
}) {
  if (status === "pending") {
    return <p className="text-xs text-gray-500 text-center">Loading your production panel proof…</p>;
  }
  // An error here must not obscure the design: the master and its proofs are
  // read through their own surfaces and are unaffected.
  if (status === "error" || !proof) return null;
  // A six-surface / field / hero-driver run has no three-zone document. That is
  // a routing fact, not a failure, and it is not worth a message.
  if (!proof.panelProof || !proof.quadrants) return null;

  const quadrants = proof.quadrants;
  return (
    <section aria-label="Production panel proof" className="mt-4 w-full max-w-5xl">
      <h3 className="text-base font-semibold text-gray-900 text-center">Your production panel proof</h3>
      <p className="text-xs text-gray-600 text-center mt-1 max-w-2xl mx-auto">
        One sheet, three zones: the print panels, the same panels without type or logos, and every
        brand element drawn separately. Every file below is cut from this one sheet.
      </p>

      {proof.sheet?.signedUrl ? (
        <a href={proof.sheet.signedUrl} target="_blank" rel="noreferrer" className="block mt-3">
          <img
            src={proof.sheet.signedUrl}
            alt="The three-zone production panel proof"
            className="w-full rounded-lg border border-gray-200 bg-gray-50"
          />
        </a>
      ) : (
        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-6 text-center text-xs text-gray-500">
          The proof sheet is not available to preview right now. The panels below are unaffected.
        </div>
      )}

      {ZONES.map((zone) => {
        const panels = quadrants[zone.key] || [];
        if (panels.length === 0) return null;
        return (
          <div key={zone.key} className="mt-5">
            <p className="text-sm font-semibold text-gray-900">
              {zone.title} <span className="font-normal text-gray-500">({panels.length})</span>
            </p>
            <p className="text-[11px] text-gray-600 mt-0.5 max-w-2xl">{zone.blurb}</p>
            <ul className="mt-2 grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
              {panels.map((panel) => (
                <PanelCard key={`${zone.key}:${panel.surfaceKey}`} panel={panel} />
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

export function AtlasPanelProofSheetLoader({ requestId, revisionId }: { requestId: string; revisionId?: string }) {
  const query = useQuery({
    queryKey: ["designpro-atlas-panel-proof", requestId],
    // Loaded on demand: the API module builds the Supabase client at import
    // time, and this strip must stay mountable (and testable) without it.
    queryFn: async () => (await import("@/lib/designpro-api")).dpApi.getAtlasPanelProof(requestId),
    staleTime: 60_000,
    retry: false,
  });
  if (revisionId && query.data?.revisionId && query.data.revisionId !== revisionId) {
    return <p className="text-xs text-gray-500">The production proof belongs to a different revision.</p>;
  }
  return <AtlasPanelProofSheet proof={query.data} status={query.status} />;
}
