import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AtlasPanelProof, PanelProofPanel } from "@/lib/designpro-api";
import { PROOF_BRAND } from "@/lib/os-brand";

/** One landscape presentation of the saved artwork, never another producer. */
export const PROOF_DISPLAY_SIZE = { width: 1600, height: 900 } as const;
const SURFACES = ["driver", "passenger", "roof", "hood", "front", "rear"] as const;
const COLUMN_WIDTHS = [410, 410, 164, 164, 164, 164];
const CUT_SLOT_LABEL: Record<string, string> = {
  logo: "Primary logo", typography: "Brand text", tagline: "Tagline / slogan",
  contact: "Contact line", promo: "Promotional text", icons: "Icons / service graphics",
};

function panelLabel(panel: PanelProofPanel): string {
  if (panel.role === "cut-graphic") return CUT_SLOT_LABEL[panel.surfaceKey] || panel.surfaceKey;
  return panel.surfaceKey.charAt(0).toUpperCase() + panel.surfaceKey.slice(1);
}

/** Fit to the physical ratio without stretching, rotating or changing any file. */
export function fitProofPanel(widthIn: number | null | undefined, heightIn: number | null | undefined, maxWidth: number, maxHeight: number) {
  const w = Number(widthIn), h = Number(heightIn);
  if (![w, h, maxWidth, maxHeight].every(value => Number.isFinite(value) && value > 0)) return null;
  const scale = Math.min(maxWidth / w, maxHeight / h);
  return { width: w * scale, height: h * scale };
}

function sheetCropFor(panel: PanelProofPanel, sheet: AtlasPanelProof["sheet"]) {
  const rect = panel.sheetRect;
  const geometry = sheet?.geometry;
  if (!sheet?.signedUrl || !rect || !geometry) return null;
  if (![rect.left, rect.top, rect.width, rect.height, geometry.width, geometry.height].every(Number.isFinite)
    || rect.left < 0 || rect.top < 0 || rect.width <= 0 || rect.height <= 0
    || geometry.width <= 0 || geometry.height <= 0
    || rect.left + rect.width > geometry.width || rect.top + rect.height > geometry.height) return null;
  return { rect, geometry, url: sheet.signedUrl };
}

function PanelGraphic({ panel, sheet, x, y, width, height, onLoad }: {
  panel: PanelProofPanel; sheet: AtlasPanelProof["sheet"];
  x: number; y: number; width: number; height: number; onLoad: () => void;
}) {
  const crop = sheetCropFor(panel, sheet);
  // Reuse the source sheet when an exact rectangle is published. One shared
  // image request supplies these viewports; the browser produces no print file.
  if (crop) return (
    <svg x={x} y={y} width={width} height={height}
      viewBox={`${crop.rect.left} ${crop.rect.top} ${crop.rect.width} ${crop.rect.height}`}
      preserveAspectRatio="xMidYMid meet" overflow="hidden" aria-label={panelLabel(panel)}>
      <image href={crop.url} width={crop.geometry.width} height={crop.geometry.height} onLoad={onLoad} />
    </svg>
  );
  if (panel.signedUrl) return <image href={panel.signedUrl} x={x} y={y} width={width} height={height}
    preserveAspectRatio="xMidYMid meet" aria-label={panelLabel(panel)} onLoad={onLoad} />;
  return <text x={x + width / 2} y={y + height / 2} textAnchor="middle" fontSize="13" fill="#64748b">
    {panel.persisted === false ? `Not saved — ${panel.reason || "reason not recorded"}` : "Preview not available"}
  </text>;
}

/**
 * 16:9 is the presentation canvas, NOT a Gemini or printable-panel constraint.
 * Only saved images / exact published sheet rectangles are placed here. The
 * source document, panel dimensions, five-inch bleed and all hashes stay intact.
 */
function LandscapeProof({ proof, onSheetLoad }: { proof: AtlasPanelProof; onSheetLoad?: () => void }) {
  const groups = proof.quadrants!;
  const all = [...(groups.branded || []), ...(groups.clean || []), ...(groups.cutGraphics || [])];
  const expected = all.filter(panel => panel.signedUrl || sheetCropFor(panel, proof.sheet));
  const signature = expected.map(panel => `${panel.role}:${panel.surfaceKey}:${panel.signedUrl || proof.sheet?.signedUrl}`).join("|");
  const loaded = useRef({ signature, keys: new Set<string>(), reported: false });
  if (loaded.current.signature !== signature) loaded.current = { signature, keys: new Set(), reported: false };
  const markLoaded = (panel: PanelProofPanel) => {
    if (loaded.current.signature !== signature) return;
    loaded.current.keys.add(`${panel.role}:${panel.surfaceKey}`);
    if (!loaded.current.reported && expected.length > 0 && loaded.current.keys.size === expected.length) {
      loaded.current.reported = true;
      onSheetLoad?.();
    }
  };
  // Historical records may expose the complete source sheet but no usable
  // Zone 1 URLs/rectangles. Show that saved document once rather than erase it
  // or invent crop coordinates. Current records use the reflowed landscape.
  if (!(groups.branded || []).some(panel => panel.signedUrl || sheetCropFor(panel, proof.sheet)) && proof.sheet?.signedUrl) {
    return <div className="mt-3 aspect-video overflow-hidden rounded-md border border-gray-200 bg-white">
      <img src={proof.sheet.signedUrl} alt={`The ${PROOF_BRAND.full}`} className="h-full w-full object-contain"
        loading="eager" onLoad={onSheetLoad} />
    </div>;
  }
  const surfaceRow = (key: "branded" | "clean", top: number) => {
    let left = 32;
    return SURFACES.map((surface, index) => {
      const panel = groups[key]?.find(item => item.surfaceKey === surface);
      const cellWidth = COLUMN_WIDTHS[index];
      const x = left;
      left += cellWidth + 12;
      const fit = panel ? fitProofPanel(panel.widthIn, panel.heightIn, cellWidth, 174) : null;
      const label = surface.charAt(0).toUpperCase() + surface.slice(1);
      return <g key={`${key}:${surface}`} data-proof-panel={`${key}:${surface}`}>
        {panel && fit ? <PanelGraphic panel={panel} sheet={proof.sheet}
          x={x + (cellWidth - fit.width) / 2} y={top + 174 - fit.height}
          width={fit.width} height={fit.height} onLoad={() => markLoaded(panel)} />
          : <text x={x + cellWidth / 2} y={top + 100} textAnchor="middle" fontSize="13" fill="#64748b">Preview not available</text>}
        <text x={x + cellWidth / 2} y={top + 198} textAnchor="middle" fontSize="16" fontWeight="700" fill="#0f172a">{label}</text>
        {panel && fit && <text x={x + cellWidth / 2} y={top + 219} textAnchor="middle" fontSize="14" fill="#475569">
          {`${Number(Number(panel.widthIn).toFixed(1))}″ × ${Number(Number(panel.heightIn).toFixed(1))}″`}
        </text>}
      </g>;
    });
  };
  const graphics = groups.cutGraphics || [];
  const graphicWidth = graphics.length ? (1536 - 12 * (graphics.length - 1)) / graphics.length : 1536;
  const band = (y: number, label: string, color: string) => <g>
    <rect x="32" y={y} width="1536" height="32" rx="2" fill={color} />
    <text x="46" y={y + 22} fontSize="17" fontWeight="700" fill="white">{label}</text>
  </g>;
  return <div className="mt-3 overflow-x-auto rounded-md border border-gray-200 bg-white">
    <svg role="img" aria-label={`The ${PROOF_BRAND.full} — 16:9 landscape`}
      viewBox={`0 0 ${PROOF_DISPLAY_SIZE.width} ${PROOF_DISPLAY_SIZE.height}`}
      preserveAspectRatio="xMidYMid meet" className="block w-full" style={{ minWidth: 960, aspectRatio: "16 / 9" }}>
      <title>{PROOF_BRAND.full}: one landscape sheet, three zones</title>
      <rect width="1600" height="900" fill="white" />
      <text x="800" y="40" textAnchor="middle" fontSize="27" fontWeight="700" fill="#0f172a">{PROOF_BRAND.full}</text>
      <text x="800" y="67" textAnchor="middle" fontSize="15" fill="#475569">Six vehicle surfaces · Original panel proportions · Dimensions include 5″ bleed</text>
      {band(88, "Zone 1 — print panels", "#1d4ed8")}
      {surfaceRow("branded", 132)}
      {band(378, "Zone 2 — panels without type or logos", "#15803d")}
      {surfaceRow("clean", 422)}
      {band(668, "Zone 3 — logo, text and graphic elements", "#ea580c")}
      {graphics.map((panel, index) => <g key={`cutGraphics:${panel.surfaceKey}`} data-proof-panel={`cutGraphics:${panel.surfaceKey}`}>
        <PanelGraphic panel={panel} sheet={proof.sheet} x={32 + index * (graphicWidth + 12)} y={712}
          width={graphicWidth} height={120} onLoad={() => markLoaded(panel)} />
        <text x={32 + index * (graphicWidth + 12) + graphicWidth / 2} y="854" textAnchor="middle" fontSize="14" fill="#475569">{panelLabel(panel)}</text>
      </g>)}
      <text x="800" y="884" textAnchor="middle" fontSize="13" fill="#64748b">Design review · Plotter-ready contours are validated in the production pack</text>
    </svg>
  </div>;
}

export function AtlasPanelProofSheet({ proof, status, onSheetLoad }: {
  proof: AtlasPanelProof | undefined;
  status: "pending" | "error" | "success";
  onSheetLoad?: () => void;
}) {
  // React Query retains the last successful data during a refresh failure.
  // Keep that same request's saved proof visible; a transport error is not a
  // reason to blank accepted artwork or demand another paid generation.
  if (!proof && status === "pending") return <p className="text-xs text-gray-500 text-center">Loading your {PROOF_BRAND.full}…</p>;
  if (!proof?.panelProof || !proof.quadrants) return null;
  return <section aria-label={PROOF_BRAND.full} className="w-full rounded-lg border border-gray-200 bg-white p-3 sm:p-4">
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600">
      <span>One landscape proof · Scroll sideways to inspect on mobile</span>
      {proof.sheet?.signedUrl && <a href={proof.sheet.signedUrl} target="_blank" rel="noreferrer" className="font-semibold text-blue-700 underline">Open source proof</a>}
    </div>
    <LandscapeProof proof={proof} onSheetLoad={onSheetLoad} />
    {status === "error" && <p className="mt-2 text-xs text-amber-700">Preview refresh interrupted. Your saved proof remains visible.</p>}
  </section>;
}

/** Generation polling and request/revision identity are unchanged. */
export const PANEL_PROOF_POLL_MS = 1_000;
export const PANEL_PROOF_URL_REFRESH_MS = 240_000;
export const PANEL_PROOF_LANDING_STATES: ReadonlySet<string> = new Set(["queued", "leased", "retryable"]);
export function panelProofStillLanding(generationState: string | null | undefined): boolean {
  return PANEL_PROOF_LANDING_STATES.has(String(generationState || ""));
}
export function panelProofRendered(proof: AtlasPanelProof | undefined): boolean {
  return Boolean(proof?.panelProof && proof.sheet?.signedUrl);
}
export function panelProofRefreshInterval(proof: AtlasPanelProof | undefined, pollWhilePending: boolean): number | false {
  if (panelProofRendered(proof)) return PANEL_PROOF_URL_REFRESH_MS;
  return pollWhilePending ? PANEL_PROOF_POLL_MS : false;
}
export function panelProofBelongsToOtherRevision(
  proof: Pick<AtlasPanelProof, "panelProof" | "revisionId"> | undefined,
  revisionId: string | undefined,
): boolean {
  return Boolean(revisionId && proof?.panelProof && proof.revisionId && proof.revisionId !== revisionId);
}
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
