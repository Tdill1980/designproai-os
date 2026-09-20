import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AtlasPanelProof, PanelProofPanel } from "@/lib/designpro-api";

/**
 * Display the completed three-zone document independently of 3D views.
 * Zone 1 contains composed panels; Zone 2 retains background artwork;
 * Zone 3 retains original assets and outlined text. Preview availability
 * never confers production approval or creates another generation.
 */

const ZONES: Array<{
  key: "branded" | "clean" | "cutGraphics";
  title: string;
  blurb: string;
}> = [
  {
    key: "branded",
    title: "Zone 1 — print panels",
    blurb: "Full design panels for your vehicle proofs and production review.",
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
  if (!Number.isFinite(panel.widthIn) || !Number.isFinite(panel.heightIn)) return null;
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
  onSheetLoad,
}: {
  proof: AtlasPanelProof | undefined;
  status: "pending" | "error" | "success";
  onSheetLoad?: () => void;
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
    <section aria-label="Production panel proof" className="w-full max-w-5xl rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="text-base font-semibold text-gray-900 text-center">Your production panel proof</h3>
      <p className="text-xs text-gray-600 text-center mt-1 max-w-2xl mx-auto">
        One sheet, three zones: full design panels, background artwork, and original brand assets.
        Backgrounds and brand assets remain separate for production.
      </p>

      {proof.sheet?.signedUrl ? (
        <a href={proof.sheet.signedUrl} target="_blank" rel="noreferrer" className="block mt-3">
          <img
            src={proof.sheet.signedUrl}
            alt="The three-zone production panel proof"
            loading="eager"
            onLoad={onSheetLoad}
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

/** Poll only while a live request is waiting, then refresh expiring preview URLs. */
export function panelProofRefreshInterval(proof: AtlasPanelProof | undefined, pollWhilePending: boolean): number | false {
  if (proof?.panelProof && proof.sheet?.signedUrl) return 240_000;
  return pollWhilePending ? 1_000 : false;
}

export function AtlasPanelProofSheetLoader({ requestId, revisionId, pollWhilePending = false, submittedAt }: {
  requestId: string; revisionId?: string; pollWhilePending?: boolean; submittedAt?: number | null;
}) {
  const measured = useRef<string | null>(null);
  const query = useQuery({
    queryKey: ["designpro-atlas-panel-proof", requestId],
    queryFn: async () => (await import("@/lib/designpro-api")).dpApi.getAtlasPanelProof(requestId),
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: q => panelProofRefreshInterval(q.state.data, pollWhilePending),
    refetchIntervalInBackground: false,
    retry: false,
  });
  // An operator inspecting a pinned revision must not see an unbound preview.
  if (revisionId && query.data?.panelProof && query.data.revisionId !== revisionId) {
    return <p className="text-xs text-gray-500">The production proof belongs to a different revision.</p>;
  }
  const recordVisible = () => {
    if (measured.current === requestId || submittedAt == null || !Number.isFinite(submittedAt)) return;
    measured.current = requestId;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      performance.measure(`designpro:production-proof-visible:${requestId}`, {
        start: submittedAt,
        end: performance.now(),
        detail: { requestId, contentHash: query.data?.sheet?.contentHash },
      });
    }));
  };
  return <AtlasPanelProofSheet proof={query.data} status={query.status} onSheetLoad={recordVisible} />;
}
