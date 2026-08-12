/**
 * Immutable RevisionStudio version projection.
 *
 * A version card must describe pixels, never a stale UI hint. The durable
 * design_version_commits snapshot is compared with its parent snapshot and
 * only canonical view keys whose URLs changed are considered revised.
 */
export const REVISION_SURFACE_ORDER = [
  "side",
  "passenger-side",
  "hood_detail",
  "front",
  "rear",
  "close-up",
  "roof",
] as const;

export type RevisionSurfaceKey = (typeof REVISION_SURFACE_ORDER)[number];

export type RevisionRenderUrls = Record<string, string>;

function asUrlMap(value: unknown): RevisionRenderUrls {
  if (Array.isArray(value)) {
    return Object.fromEntries(
      value.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const candidate = entry as Record<string, unknown>;
        const view = typeof candidate.view === "string" ? candidate.view : null;
        const url = typeof candidate.url === "string" ? candidate.url.trim() : "";
        return view && url ? [[view, url]] : [];
      }),
    ) as RevisionRenderUrls;
  }
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      ([, url]) => typeof url === "string" && url.trim().length > 0,
    ),
  ) as RevisionRenderUrls;
}

export function durableRevisionRenderUrls(
  commit: {
    revision_snapshot?: { renderUrls?: unknown } | null;
    angle_renders_json?: unknown;
  } | null | undefined,
  fallback: unknown,
): RevisionRenderUrls {
  const frozen = asUrlMap(commit?.revision_snapshot?.renderUrls);
  if (Object.keys(frozen).length > 0) return frozen;
  const legacyFrozen = asUrlMap(commit?.angle_renders_json);
  if (Object.keys(legacyFrozen).length > 0) return legacyFrozen;
  return asUrlMap(fallback);
}

/**
 * Read pixels from an immutable commit only. A version-history projection must
 * never silently substitute the current mutable color_visualizations row when
 * an older commit is incomplete; that would make an old card display new art.
 */
export function frozenRevisionRenderUrls(
  commit: {
    revision_snapshot?: { renderUrls?: unknown } | null;
    angle_renders_json?: unknown;
  } | null | undefined,
): RevisionRenderUrls {
  const snapshot = asUrlMap(commit?.revision_snapshot?.renderUrls);
  if (Object.keys(snapshot).length > 0) return snapshot;
  return asUrlMap(commit?.angle_renders_json);
}

export function changedRevisionSurfaceKeys(
  previous: unknown,
  current: unknown,
): RevisionSurfaceKey[] {
  const before = asUrlMap(previous);
  const after = asUrlMap(current);
  return REVISION_SURFACE_ORDER.filter(
    (key) => (before[key] || null) !== (after[key] || null),
  );
}

function canonicalDeclaredKeys(value: unknown): RevisionSurfaceKey[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<string>(REVISION_SURFACE_ORDER);
  return Array.from(
    new Set(value.filter((key): key is RevisionSurfaceKey => typeof key === "string" && allowed.has(key))),
  );
}

export interface RevisionSurfaceProjection {
  changedKeys: RevisionSurfaceKey[];
  primaryKey: RevisionSurfaceKey | null;
  currentUrl: string | null;
  previousUrl: string | null;
}

/**
 * Resolve the surface represented by a human version.
 *
 * Actual snapshot differences outrank every metadata field. This is the lock
 * that prevents an old `revised_view_key: hood_detail` from showing a hood
 * after Driver and Passenger were the pixels that changed. When both sides
 * changed, Driver is the stable primary and both remain in changedKeys.
 */
export function projectRevisionSurface({
  previousUrls,
  currentUrls,
  declaredViewKeys,
  revisedViewKey,
}: {
  previousUrls?: unknown;
  currentUrls: unknown;
  declaredViewKeys?: unknown;
  revisedViewKey?: unknown;
}): RevisionSurfaceProjection {
  const before = asUrlMap(previousUrls);
  const after = asUrlMap(currentUrls);
  const actualChanged = changedRevisionSurfaceKeys(before, after);
  const declared = canonicalDeclaredKeys(declaredViewKeys).filter((key) => !!after[key]);
  const revised = canonicalDeclaredKeys([revisedViewKey]).filter((key) => !!after[key]);

  // With a parent, URL inequality is authoritative. Metadata is only a legacy
  // fallback when a parent snapshot does not exist (normally V1).
  const hasPreviousSnapshot = Object.keys(before).length > 0;
  const changedKeys = hasPreviousSnapshot
    ? actualChanged
    : (declared.length > 0 ? declared : revised);

  const primaryKey =
    REVISION_SURFACE_ORDER.find((key) => changedKeys.includes(key) && !!after[key]) ||
    (!hasPreviousSnapshot && after.side ? "side" : null);

  return {
    changedKeys,
    primaryKey,
    currentUrl: primaryKey ? after[primaryKey] || null : null,
    previousUrl: primaryKey ? before[primaryKey] || null : null,
  };
}

export interface RevisionTimelineRowLike {
  id: string;
  created_at?: string | null;
  render_urls?: unknown;
  admin_notes?: unknown;
}

export interface RevisionTimelineCommitLike {
  id: string;
  job_id?: string | null;
  designiq_generation_id?: string | null;
  source_visualization_id?: string | null;
  version_number?: number | null;
  created_at?: string | null;
  user_prompt?: string | null;
  hero_render_url?: string | null;
  angle_renders_json?: unknown;
  revision_snapshot?: {
    visualizationId?: string;
    renderUrls?: unknown;
    change?: { viewKeys?: string[]; prompt?: string | null };
  } | null;
}

export interface RevisionTimelineEntry<
  TRow extends RevisionTimelineRowLike = RevisionTimelineRowLike,
  TCommit extends RevisionTimelineCommitLike = RevisionTimelineCommitLike,
> extends RevisionSurfaceProjection {
  key: string;
  immutable: boolean;
  versionNumber: number;
  createdAt: string | null;
  revisionNotes: string | null;
  row: TRow | null;
  commit: TCommit | null;
  currentUrls: RevisionRenderUrls;
  previousUrls: RevisionRenderUrls;
  previousKey: string | null;
  thumbnailUrl: string | null;
}

function parsedNotes(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function rowGenerationId(row: RevisionTimelineRowLike): string | null {
  const notes = parsedNotes(row.admin_notes);
  return typeof notes.designiq_generation_id === "string"
    ? notes.designiq_generation_id
    : null;
}

function legacyMetadata(row: RevisionTimelineRowLike): {
  versionNumber: number | null;
  revisionNotes: string | null;
  viewKeys: string[];
  revisedViewKey: string | null;
} {
  const notes = parsedNotes(row.admin_notes);
  const version = notes.version && typeof notes.version === "object"
    ? notes.version as Record<string, unknown>
    : notes;
  const versionNumber = Number(version.number ?? version.version_number ?? version.version);
  const revisionNotes = [
    version.revision_notes,
    version.revision_prompt,
    notes.revision_notes,
    notes.revision_prompt,
  ].find((value) => typeof value === "string" && value.trim()) as string | undefined;
  const rawKeys = version.changed_view_keys ?? notes.changed_view_keys;
  const revisedViewKey = [version.revised_view_key, notes.revised_view_key]
    .find((value) => typeof value === "string") as string | undefined;
  return {
    versionNumber: Number.isFinite(versionNumber) && versionNumber > 0 ? versionNumber : null,
    revisionNotes: revisionNotes || null,
    viewKeys: Array.isArray(rawKeys) ? rawKeys.filter((key): key is string => typeof key === "string") : [],
    revisedViewKey: revisedViewKey || null,
  };
}

function createdAtValue(value: string | null | undefined): number {
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Build RevisionStudio's visible history from the immutable ledger.
 *
 * When commits exist, every commit becomes exactly one card—even when several
 * commits point at the same mutable visualization row. The row is used only
 * for presentation metadata; its render_urls are never used for a commit.
 * Legacy color_visualizations rows are projected only when no immutable commit
 * exists for the lineage.
 */
export function buildRevisionVersionTimeline<
  TRow extends RevisionTimelineRowLike,
  TCommit extends RevisionTimelineCommitLike,
>({
  commits,
  legacyRows,
}: {
  commits?: TCommit[] | null;
  legacyRows?: TRow[] | null;
}): RevisionTimelineEntry<TRow, TCommit>[] {
  const rows = [...(legacyRows || [])].sort((a, b) =>
    createdAtValue(a.created_at) - createdAtValue(b.created_at) ||
    String(a.id).localeCompare(String(b.id)),
  );
  const rowsById = new Map(rows.map((row) => [String(row.id), row]));
  const rowsByGenerationId = new Map<string, TRow>();
  for (const row of rows) {
    const generationId = rowGenerationId(row);
    if (generationId) rowsByGenerationId.set(generationId, row);
  }

  const versionSortValue = (value: unknown): number => {
    const version = Number(value);
    return Number.isFinite(version) && version > 0 ? version : Number.MAX_SAFE_INTEGER;
  };
  const immutableCommits = [...(commits || [])].sort((a, b) =>
    versionSortValue(a.version_number) - versionSortValue(b.version_number) ||
    createdAtValue(a.created_at) - createdAtValue(b.created_at) ||
    String(a.id).localeCompare(String(b.id)),
  );

  type TimelineSource = {
    key: string;
    immutable: boolean;
    versionNumber: number | null;
    createdAt: string | null;
    revisionNotes: string | null;
    row: TRow | null;
    commit: TCommit | null;
    currentUrls: RevisionRenderUrls;
    declaredViewKeys: unknown;
    revisedViewKey: unknown;
    thumbnailFallback: string | null;
  };
  const sources: TimelineSource[] = [];
  const representedRowIds = new Set<string>();

  for (const commit of immutableCommits) {
    const snapshotVisualizationId = commit.revision_snapshot?.visualizationId;
    const exactRowIds = [
      commit.source_visualization_id,
      snapshotVisualizationId,
      commit.job_id,
    ].filter((id): id is string => typeof id === "string" && id.length > 0);
    const generationIds = [commit.designiq_generation_id, commit.job_id]
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    const row = exactRowIds.map((id) => rowsById.get(id)).find(Boolean) ||
      generationIds.map((id) => rowsByGenerationId.get(id)).find(Boolean) ||
      null;
    if (row) representedRowIds.add(String(row.id));
    const versionNumber = Number(commit.version_number);
    const snapshotPrompt = commit.revision_snapshot?.change?.prompt;
    sources.push({
      key: `commit:${commit.id}`,
      immutable: true,
      versionNumber: Number.isFinite(versionNumber) && versionNumber > 0 ? versionNumber : null,
      createdAt: commit.created_at || null,
      // Immutable presentation may read only immutable commit fields. Mutable
      // row notes often describe a later edit and must not leak backward.
      revisionNotes: typeof commit.user_prompt === "string" && commit.user_prompt.trim()
        ? commit.user_prompt
        : typeof snapshotPrompt === "string" && snapshotPrompt.trim()
          ? snapshotPrompt
          : null,
      row,
      commit,
      currentUrls: frozenRevisionRenderUrls(commit),
      declaredViewKeys: commit.revision_snapshot?.change?.viewKeys,
      revisedViewKey: null,
      thumbnailFallback: commit.hero_render_url || null,
    });
  }

  // Preserve legacy versions that have no immutable representative. This keeps
  // a pre-ledger V1 visible beside durable V2/V3 without ever using that legacy
  // row as the pixels for a commit that points at it.
  for (const [rowIndex, row] of rows.entries()) {
    if (representedRowIds.has(String(row.id))) continue;
    const metadata = legacyMetadata(row);
    sources.push({
      key: `legacy:${row.id}`,
      immutable: false,
      versionNumber: metadata.versionNumber || rowIndex + 1,
      createdAt: row.created_at || null,
      revisionNotes: metadata.revisionNotes,
      row,
      commit: null,
      currentUrls: asUrlMap(row.render_urls),
      declaredViewKeys: metadata.viewKeys,
      revisedViewKey: metadata.revisedViewKey,
      thumbnailFallback: null,
    });
  }

  sources.sort((a, b) =>
    versionSortValue(a.versionNumber) - versionSortValue(b.versionNumber) ||
    createdAtValue(a.createdAt) - createdAtValue(b.createdAt) ||
    a.key.localeCompare(b.key),
  );

  const timeline: RevisionTimelineEntry<TRow, TCommit>[] = [];
  for (const [index, source] of sources.entries()) {
    const previous = timeline[index - 1] || null;
    const previousUrls = previous?.currentUrls || {};
    const projection = projectRevisionSurface({
      previousUrls,
      currentUrls: source.currentUrls,
      declaredViewKeys: source.declaredViewKeys,
      revisedViewKey: source.revisedViewKey,
    });
    timeline.push({
      key: source.key,
      immutable: source.immutable,
      versionNumber: source.versionNumber || index + 1,
      createdAt: source.createdAt,
      revisionNotes: source.revisionNotes,
      row: source.row,
      commit: source.commit,
      currentUrls: source.currentUrls,
      previousUrls,
      previousKey: previous?.key || null,
      thumbnailUrl: projection.currentUrl || source.thumbnailFallback,
      ...projection,
    });
  }
  return timeline;
}
