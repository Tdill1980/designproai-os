/**
 * CANONICAL DESIGN ID (DID) — the ONE derivation (Trish 2026-07-24).
 *
 * The old "design id" was broken by construction: every surface derived its own
 * `DID-{slice}` from whatever id it happened to hold (render id, pack id,
 * panel_artboard job id, server-issued did from the AI function), so the SAME
 * design showed DIFFERENT DIDs on different pages — useless for tracking.
 *
 * The DID is now defined ONCE, here, and it is always derived from the
 * CANONICAL DesignIQ generation id — the same canonical id the Build Assets
 * vault, PanelPro board, and activate-print-worker already resolve (a render's
 * `color_visualizations.admin_notes.designiq_generation_id` back-link, falling
 * back to the row's own id when no link exists). Same design → same DID on the
 * QC certificate, RevisionStudio, DesignPro, WrapBox, and the proofs.
 *
 * Pure data + text — the DID is NEVER a canvas/Konva object. It renders as
 * HTML (DesignIDBadge) or as text drawn by the existing deterministic stampers
 * (QC certificate canvas, server-side proof band). No schema change: the
 * derivation is deterministic from the UUID.
 */

/** Format a canonical id as a DID. Returns null when there's nothing to format. */
export function formatDid(canonicalId?: string | null): string | null {
  const hex = String(canonicalId || "").replace(/-/g, "");
  if (hex.length < 8) return null;
  return `DID-${hex.slice(0, 8).toUpperCase()}`;
}

/**
 * THE ID LADDER (owner ruling). The Generation ID is minted at Call 1 — the
 * moment the vehicle is entered and Generate is pressed. The Design ID
 * (`DID-` + the first 8 hex of that generation id) and the Order ID are minted
 * when the Production Pack is PURCHASED. Before that purchase a customer surface
 * has exactly one identity to show, and it is the Generation ID.
 *
 * `formatDid` above stays the one DID derivation for the post-purchase
 * surfaces (WrapBox, the vault, the QC certificate). These two helpers are
 * what a PRE-purchase customer surface uses instead.
 */

/** Short Generation ID for a customer chip: the first 8 hex, upper-case, no `DID-`. */
export function shortGenerationId(generationId?: string | null): string | null {
  const hex = String(generationId || "").replace(/-/g, "");
  if (hex.length < 8) return null;
  return hex.slice(0, 8).toUpperCase();
}

export type CustomerDesignIdentity = { label: "Design ID" | "Generation ID"; value: string };

/**
 * The one identity chip a customer surface shows for a design.
 *
 * `purchasedDesignId` is the DID a PURCHASE minted (a WrapBox / production-pack
 * row's `design_id`), never one derived on the spot from the generation id —
 * deriving it is what printed a DID before anything was bought. With no
 * purchase signal the chip is the Generation ID, and nothing else.
 */
export function customerDesignIdentity(args: {
  generationId?: string | null;
  purchasedDesignId?: string | null;
}): CustomerDesignIdentity | null {
  const did = String(args.purchasedDesignId || "").trim();
  if (/^DID-[0-9A-F]{8}$/.test(did)) return { label: "Design ID", value: did };
  const short = shortGenerationId(args.generationId);
  return short ? { label: "Generation ID", value: short } : null;
}

/** Tolerant admin_notes parse (string or object). */
export function parseAdminNotes(raw: unknown): Record<string, any> {
  try {
    if (!raw) return {};
    return typeof raw === "string" ? JSON.parse(raw) : (raw as Record<string, any>);
  } catch {
    return {};
  }
}

/**
 * DID for a color_visualizations render row: prefers the canonical DesignIQ
 * back-link (admin_notes.designiq_generation_id), falls back to the row id.
 */
export function didFromRenderRow(row: { id?: string | null; admin_notes?: unknown } | null | undefined): string | null {
  if (!row) return null;
  const n = parseAdminNotes(row.admin_notes);
  return formatDid((n.designiq_generation_id as string) || row.id);
}

/**
 * DID for a production_packs row (vault / WrapBox cards): prefers the canonical
 * design id deploy-to-wrapbox stamps into the manifest (panels_selected.did /
 * .designiq_generation_id), falls back to the pack's own id for legacy packs
 * delivered before the manifest carried the design link.
 */
export function didFromPack(pack: { id?: string | null; panelsSelected?: any; panels_selected?: any } | null | undefined): string | null {
  if (!pack) return null;
  const m = pack.panelsSelected ?? pack.panels_selected ?? {};
  if (typeof m?.did === "string" && m.did.startsWith("DID-")) return m.did;
  return formatDid((m?.designiq_generation_id as string) || pack.id);
}
