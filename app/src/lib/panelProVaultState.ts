export interface PanelProVaultPanel {
  sideKey: string;
  label: string;
  view: string;
  brandedUrl: string;
  cleanUrl?: string;
  printDims?: {
    widthInches: number;
    heightInches: number;
    bleedInches: number;
    source: string;
  };
}

export interface PanelProVaultPack {
  id: string;
  revisionId: string;
  designiqGenerationId: string;
  version: string;
  panels: PanelProVaultPanel[];
}

export interface PanelProSideDefinition {
  sideKey: string;
  label: string;
  view: string;
}

export interface PanelProVaultReconcileResult {
  qcSidePanels: Record<string, any>;
  changed: boolean;
  loadedCount: number;
}

const ACTIVE_VAULT_SOURCES = new Set(["build-assets"]);

const sameJson = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

const isVaultSource = (value: unknown) =>
  ACTIVE_VAULT_SOURCES.has(String(value || ""));

const exactVersion = (
  version: any,
  pack: PanelProVaultPack,
  url: string,
  role: "branded" | "clean",
) =>
  version?.url === url &&
  version?.entice_pack_id === pack.id &&
  version?.revision_id === pack.revisionId &&
  version?.designiq_generation_id === pack.designiqGenerationId &&
  String(version?.pack_version) === pack.version &&
  version?.vault_role === role;

/**
 * Reconcile Studio Board's persisted cache to one exact verified Entice Pack.
 * Existing versions are immutable history. Only a machine-owned active pointer
 * may be replaced or cleared; manual uploads and edits are never removed.
 */
export function reconcilePanelProVaultState(
  current: Record<string, any>,
  sideDefinitions: PanelProSideDefinition[],
  pack: PanelProVaultPack | null,
  now = new Date().toISOString(),
): PanelProVaultReconcileResult {
  const previous = current || {};
  const next = { ...previous };
  const desiredBySide = new Map(
    (pack?.panels || []).map((panel) => [panel.sideKey, panel]),
  );
  let changed = false;

  for (const def of sideDefinitions) {
    const prevSide = previous[def.sideKey] || {};
    const versions: any[] = Array.isArray(prevSide.versions)
      ? [...prevSide.versions]
      : [];
    if (versions.length === 0 && prevSide.gemini_url) {
      versions.push({
        id: `legacy-${def.sideKey}`,
        url: prevSide.gemini_url,
        source: prevSide.gemini_source || "upload",
        createdAt: prevSide.gemini_uploaded_at || now,
      });
    }

    const activeUrl = String(prevSide.gemini_url || "");
    const activeVersion = [...versions]
      .reverse()
      .find((version) => version?.url === activeUrl);
    const machineOwnsActive =
      !!prevSide.active_entice_pack_id ||
      isVaultSource(prevSide.gemini_source) ||
      isVaultSource(activeVersion?.source);
    const desired = pack ? desiredBySide.get(def.sideKey) : undefined;

    if (!desired || !pack) {
      if (!activeUrl || !machineOwnsActive) continue;
      const nextSide: any = {
        ...prevSide,
        versions,
        gemini_url: "",
        gemini_source: "",
        approved: false,
        approved_at: null,
        gemini_uploaded_at: now,
      };
      delete nextSide.active_entice_pack_id;
      delete nextSide.active_entice_revision_id;
      delete nextSide.active_entice_designiq_generation_id;
      delete nextSide.active_entice_pack_version;
      delete nextSide.active_entice_vault_role;
      if (!sameJson(prevSide, nextSide)) {
        next[def.sideKey] = nextSide;
        changed = true;
      }
      continue;
    }

    const hadExactBranded = versions.some((version) => exactVersion(
      version,
      pack,
      desired.brandedUrl,
      "branded",
    ));
    const appendExact = (
      url: string | undefined,
      role: "branded" | "clean",
    ) => {
      const normalizedUrl = String(url || "").trim();
      if (!normalizedUrl) return;
      if (versions.some((version) => exactVersion(
        version,
        pack,
        normalizedUrl,
        role,
      ))) return;
      versions.push({
        id: `entice:${pack.id}:${def.sideKey}:${role}`,
        url: normalizedUrl,
        source: role === "branded" ? "build-assets" : "clean",
        entice_pack_id: pack.id,
        revision_id: pack.revisionId,
        designiq_generation_id: pack.designiqGenerationId,
        pack_version: pack.version,
        vault_role: role,
        note: `Verified Entice Pack ${pack.id}`,
        createdAt: now,
      });
    };
    appendExact(desired.brandedUrl, "branded");
    appendExact(desired.cleanUrl, "clean");

    const identityChanged =
      activeUrl !== desired.brandedUrl ||
      prevSide.active_entice_pack_id !== pack.id ||
      prevSide.active_entice_revision_id !== pack.revisionId ||
      prevSide.active_entice_designiq_generation_id !== pack.designiqGenerationId ||
      String(prevSide.active_entice_pack_version || "") !== pack.version ||
      prevSide.active_entice_vault_role !== "branded" ||
      !hadExactBranded;
    const nextSide: any = {
      ...prevSide,
      label: desired.label,
      view: desired.view,
      versions,
      gemini_url: desired.brandedUrl,
      gemini_source: "build-assets",
      active_entice_pack_id: pack.id,
      active_entice_revision_id: pack.revisionId,
      active_entice_designiq_generation_id: pack.designiqGenerationId,
      active_entice_pack_version: pack.version,
      active_entice_vault_role: "branded",
    };
    if (identityChanged) {
      nextSide.approved = false;
      nextSide.approved_at = null;
      nextSide.gemini_uploaded_at = now;
    }
    if (desired.printDims) {
      nextSide.print_width_in = desired.printDims.widthInches;
      nextSide.print_height_in = desired.printDims.heightInches;
      nextSide.print_bleed_in = desired.printDims.bleedInches;
      nextSide.print_size_source = desired.printDims.source;
    } else if (nextSide.print_size_source === "build-assets") {
      delete nextSide.print_width_in;
      delete nextSide.print_height_in;
      delete nextSide.print_bleed_in;
      delete nextSide.print_size_source;
    }
    if (!sameJson(prevSide, nextSide)) {
      next[def.sideKey] = nextSide;
      changed = true;
    }
  }

  return {
    qcSidePanels: next,
    changed,
    loadedCount: pack?.panels.length || 0,
  };
}
