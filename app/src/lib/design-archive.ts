/**
 * THE DESIGN ARCHIVE, AS BOTH SURFACES READ IT.
 *
 * One history (`designpro_design_history`, migration 20260926010000), read by
 * RevisionStudioIQ (the customer's record) and PanelPro Studio (QC), through the
 * same gateway route. What differs is decided by the DATABASE, not by the
 * surface: a customer's copy never carries the A.T.L.A.S. master, its hashes or
 * storage paths (`audience: "customer"`); QC staff get everything. There is no
 * second prompt store and no copying between surfaces.
 *
 * Off unless VITE_DESIGNPRO_ARCHIVE_V1 is on (and the gateway's
 * DESIGNPRO_ARCHIVE_V1, and the migration applied). Off = today's UI, unchanged.
 */
import type { DesignArchiveHistory } from "@/lib/designpro-api";

const flag = String(import.meta.env.VITE_DESIGNPRO_ARCHIVE_V1 || "").toLowerCase();
export const DESIGN_ARCHIVE_UI_ENABLED = ["1", "true", "on", "enabled"].includes(flag);

/** The DesignID every surface prints: `DID-` + the first 8 hex of the GenerationID. */
export function designIdForGeneration(generationId: string | null | undefined): string {
  const hex = String(generationId || "").replace(/-/g, "").slice(0, 8).toUpperCase();
  return /^[0-9A-F]{8}$/.test(hex) ? `DID-${hex}` : "";
}

export type ArchiveTimelineEntry =
  | { type: "prompt"; at: string | null; version: number; prompt: DesignArchiveHistory["prompts"][number] }
  | { type: "version"; at: string | null; version: number; record: DesignArchiveHistory["versions"][number] }
  | { type: "file"; at: string | null; version: number | null; file: DesignArchiveHistory["files"][number] }
  | { type: "order"; at: string | null; version: null; order: DesignArchiveHistory["orders"][number] };

const RANK: Record<ArchiveTimelineEntry["type"], number> = { prompt: 0, version: 1, file: 2, order: 3 };

/**
 * EVERYTHING, IN THE ORDER IT HAPPENED. Every prompt the customer entered
 * (including a revision that failed, and per-view regeneration notes), every
 * version, every asset and every order, merged on their own timestamps. Ties
 * keep cause before effect: the prompt, then the version it produced, then its
 * files. An entry without a timestamp sorts last rather than being guessed.
 */
export function archiveTimeline(history: DesignArchiveHistory | null | undefined): ArchiveTimelineEntry[] {
  if (!history) return [];
  const entries: ArchiveTimelineEntry[] = [
    ...history.prompts.map((prompt) => ({ type: "prompt" as const, at: prompt.createdAt, version: prompt.version, prompt })),
    ...history.versions.map((record) => ({ type: "version" as const, at: record.createdAt, version: record.version, record })),
    ...history.files.map((file) => ({ type: "file" as const, at: file.createdAt, version: file.version, file })),
    ...history.orders.map((order) => ({ type: "order" as const, at: order.boundAt, version: null, order })),
  ];
  const time = (value: string | null) => {
    const parsed = Date.parse(String(value || ""));
    return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
  };
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => (time(a.entry.at) - time(b.entry.at))
      || (RANK[a.entry.type] - RANK[b.entry.type])
      || (a.index - b.index))
    .map(({ entry }) => entry);
}

export const PROMPT_KIND_LABEL: Record<DesignArchiveHistory["prompts"][number]["kind"], string> = {
  "original-brief": "Original brief",
  "revision-instruction": "Revision request",
  "view-regeneration": "View re-render note",
};

export function formatBytes(value: number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} KB`;
  return `${n} B`;
}
