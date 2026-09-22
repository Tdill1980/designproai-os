import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AtlasPanelProof, PanelProofPanel } from "@/lib/designpro-api";
import { PROOF_BRAND } from "@/lib/os-brand";

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

function PanelCard({ panel, sheet }: { panel: PanelProofPanel; sheet?: AtlasPanelProof["sheet"] }) {
  const size = inches(panel);
  const rect = panel.sheetRect;
  const geometry = sheet?.geometry;
  const sheetCrop = panel.role === "branded" && sheet?.signedUrl && rect && geometry
    && [rect.left, rect.top, rect.width, rect.height, geometry.width, geometry.height].every(Number.isFinite)
    && rect.left >= 0 && rect.top >= 0 && rect.width > 0 && rect.height > 0
    && rect.left + rect.width <= geometry.width && rect.top + rect.height <= geometry.height;
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
      ) : sheetCrop ? (
        <a href={sheet.signedUrl} target="_blank" rel="noreferrer" className="block">
          <svg role="img" aria-label={panelLabel(panel)}
            viewBox={`${rect.left} ${rect.top} ${rect.width} ${rect.height}`}
            className="w-full max-h-40 rounded bg-gray-50" overflow="hidden">
            <image href={sheet.signedUrl} width={geometry.width} height={geometry.height} />
          </svg>
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
    return <p className="text-xs text-gray-500 text-center">Loading your {PROOF_BRAND.full}…</p>;
  }
  // An error here must not obscure the design: the master and its proofs are
  // read through their own surfaces and are unaffected.
  if (status === "error" || !proof) return null;
  // A six-surface / field / hero-driver run has no three-zone document. That is
  // a routing fact, not a failure, and it is not worth a message.
  if (!proof.panelProof || !proof.quadrants) return null;

  const quadrants = proof.quadrants;
  return (
    <section aria-label={PROOF_BRAND.full} className="w-full max-w-5xl rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="text-base font-semibold text-gray-900 text-center">Your {PROOF_BRAND.full}</h3>
      <p className="text-xs text-gray-600 text-center mt-1 max-w-2xl mx-auto">
        {PROOF_BRAND.blurb} Backgrounds and brand assets remain separate for production.
      </p>

      {proof.sheet?.signedUrl ? (
        <a href={proof.sheet.signedUrl} target="_blank" rel="noreferrer" className="block mt-3">
          <img
            src={proof.sheet.signedUrl}
            alt={`The ${PROOF_BRAND.full}`}
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
                <PanelCard key={`${zone.key}:${panel.surfaceKey}`} panel={panel} sheet={proof.sheet} />
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

/**
 * WHEN THE SHEET CAN FIRST APPEAR, measured against the read path.
 *
 * The three-zone document is written by Call 1's `proof.assemble` node, which
 * completes BEFORE the master is accepted, before any 3D proof, and before the
 * entice handoff creates a workflow run. So the sheet is readable from
 * `GET /panel-proof` from the moment Call 1 lands it, and the only surface that
 * can be open earlier is the one watching Call 1 itself. Nothing here waits for
 * "See All Views" (locked by `tests/designpanel-view-reveal.test.mjs`); what
 * decides how soon a customer sees it is how often this loader re-reads while
 * the generation is still authoring.
 *
 * So: while the generation is in a state Call 1 can still land the sheet in,
 * the loader re-reads every `PANEL_PROOF_POLL_MS`; once the sheet has rendered,
 * the poll stops and only the expiring five-minute preview URLs are refreshed;
 * once the generation is terminal (or the caller reports nothing in flight) it
 * does not poll at all. `{panelProof:false}` is a STATE — a six-surface / field
 * / hero-driver run has no three-zone document — never an error, and it keeps
 * the same cadence, because during authoring it is also what the read answers
 * before the node lands.
 */
export const PANEL_PROOF_POLL_MS = 1_000;
/** Signed preview URLs expire in five minutes; refresh them well inside that. */
export const PANEL_PROOF_URL_REFRESH_MS = 240_000;

/** Generation states in which Call 1 may still be authoring, or its proof row still landing. */
export const PANEL_PROOF_LANDING_STATES: ReadonlySet<string> = new Set(["queued", "leased", "retryable"]);

/** True while the generation is in a state Call 1 can still land the sheet in. */
export function panelProofStillLanding(generationState: string | null | undefined): boolean {
  return PANEL_PROOF_LANDING_STATES.has(String(generationState || ""));
}

/** The sheet is on screen: a three-zone document with a signed sheet preview. */
export function panelProofRendered(proof: AtlasPanelProof | undefined): boolean {
  return Boolean(proof?.panelProof && proof.sheet?.signedUrl);
}

/** Poll only while a live request can still land the sheet, then refresh expiring preview URLs. */
export function panelProofRefreshInterval(proof: AtlasPanelProof | undefined, pollWhilePending: boolean): number | false {
  if (panelProofRendered(proof)) return PANEL_PROOF_URL_REFRESH_MS;
  return pollWhilePending ? PANEL_PROOF_POLL_MS : false;
}

/**
 * Whether a pinned revision may show this proof. A revision IS its own
 * generation request (`enqueue_designpro_atlas_revision` inserts a new
 * `designpro_generation_requests` row), so `requestId` already names the
 * revision and no revision argument is added to the RPC, the route or dpApi.
 * The RPC's `call1_graph` branch legitimately answers `panelProof: true,
 * revisionId: null` before the revision row lands, so a null answer is
 * "not bound yet", never "bound to a different revision". Only a NON-NULL
 * answer that names another revision is a mismatch.
 */
export function panelProofBelongsToOtherRevision(
  proof: Pick<AtlasPanelProof, "panelProof" | "revisionId"> | undefined,
  revisionId: string | undefined,
): boolean {
  return Boolean(revisionId && proof?.panelProof && proof.revisionId && proof.revisionId !== revisionId);
}

/**
 * THE ONE READER of the three-zone proof (RULE 0.21, one reader per artifact).
 * The sheet loader below renders it; the PanelPro preflight card reads the
 * SAME query -- same key, same cache entry -- to put the sheet hash, the Zone 2
 * count and the Zone 3 inventory beside the three attestations that name them.
 * Two components, one read: a second `getAtlasPanelProof` call anywhere else
 * is a second reader and must not be added.
 */
export function useAtlasPanelProof(requestId: string, pollWhilePending = false) {
  return useQuery({
    queryKey: ["designpro-atlas-panel-proof", requestId],
    queryFn: async () => (await import("@/lib/designpro-api")).dpApi.getAtlasPanelProof(requestId),
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: q => panelProofRefreshInterval(q.state.data, pollWhilePending),
    refetchIntervalInBackground: false,
    retry: false,
  });
}

export function AtlasPanelProofSheetLoader({ requestId, revisionId, pollWhilePending = false, submittedAt }: {
  requestId: string; revisionId?: string; pollWhilePending?: boolean; submittedAt?: number | null;
}) {
  const measured = useRef<string | null>(null);
  const query = useAtlasPanelProof(requestId, pollWhilePending);
  // An operator inspecting a pinned revision must not see ANOTHER revision's
  // proof. An unbound one (revisionId null, row not landed yet) is this request's.
  if (panelProofBelongsToOtherRevision(query.data, revisionId)) {
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
