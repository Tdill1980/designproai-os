/**
 * asset-version.ts — single source of truth for design/asset versioning.
 */
export interface VersionInfo {
  version: number;
  parentId: string | null;
  isRevision: boolean;
  revisionNotes: string;
  clonedAt: string | null;
  revisedViewKey: string | null;
  changedViewKeys: string[];
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((key): key is string => typeof key === "string" && key.length > 0)));
}

export function parseVersionInfo(render: any): VersionInfo {
  const name = render?.design_file_name || render?.color_name || "";
  const versionMatch = name.match(/\(V(\d+)\)$/);
  const version = versionMatch ? parseInt(versionMatch[1]) : 1;

  let parentId: string | null = null;
  let revisionNotes = "";
  let clonedAt: string | null = null;
  let revisedViewKey: string | null = null;
  let changedViewKeys: string[] = [];
  try {
    const notes = JSON.parse(render?.admin_notes || "{}");
    parentId = notes?.version?.parent_id || null;
    revisionNotes = notes?.version?.revision_notes || notes?.last_revision_prompt || "";
    clonedAt = notes?.version?.cloned_at || null;
    revisedViewKey =
      notes?.version?.primary_changed_view_key ||
      notes?.primary_changed_view_key ||
      notes?.version?.revised_view_key ||
      notes?.revised_view_key ||
      null;
    changedViewKeys = stringArray(
      notes?.version?.changed_view_keys || notes?.changed_view_keys,
    );
  } catch {}

  return {
    version,
    parentId,
    isRevision: version > 1 || !!revisionNotes,
    revisionNotes,
    clonedAt,
    revisedViewKey,
    changedViewKeys,
  };
}

export function getVersionLabel(render: any): string {
  const info = parseVersionInfo(render);
  return info.version > 1 ? `V${info.version}` : "V1";
}
