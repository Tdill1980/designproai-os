// WallPro designs inside RevisionStudioIQ.
//
// WallPro is its own app on DesignProAI, the way GraphicsPro is, and its
// designs appear in the same RevisionStudio grid as vehicle designs so the team
// finds every job in one place, by DesignID. A wall design is one project: the
// approved version when there is one (that is what production reads), else the
// latest draft. The grid row is the legacy card shape the page is written
// against; the wall-specific facts (panels, manifest, project link) ride in
// admin_notes.wallpro, which is how every other tool carries its extras.
//
// This module is pure so it can be tested without a Supabase client; the read
// that fills it lives in wallpro-api.ts.
import type { RevisionStudioDesignRow } from './revisionstudio-source';

export type WallStudioPanel = {
  number: number; file: string; widthIn: number; heightIn: number; widthPx: number; heightPx: number; ppi: number; byteSize: number;
  /** Signed download URL, or null when it could not be signed. */
  url: string | null;
};
export type WallStudioJob = {
  id: string; status: 'queued' | 'running' | 'ready' | 'failed'; panels: WallStudioPanel[]; manifestUrl: string | null; error: string | null;
  /** The whole wall (with bleed) as one file at the same PPI, when it was built. */
  wholeWall?: { file: string; widthIn: number; heightIn: number; widthPx: number; heightPx: number; ppi: number; byteSize: number; url: string | null } | null;
};
/** One entry of a project's immutable version history (V1, V2, ...). */
export type WallStudioVersion = { id: string; versionNo: number; kind: string; approved: boolean; prompt: string | null; createdAt: string; url: string | null };
export type WallStudioDesign = {
  projectId: string; projectName: string; versionId: string; versionNo: number; approved: boolean; designId: string;
  artworkPath: string; artworkUrl: string | null; placement: string; repeatWidthIn: number | null;
  createdAt: string; approvedAt: string | null;
  /** Every version of the project, oldest first. Never only the newest. */
  versions?: WallStudioVersion[];
  /** The latest production build for that version, when one was requested. */
  job: WallStudioJob | null;
};

export const WALL_MODE = 'wallpro';

/** The wall design's row in the RevisionStudio grid. The id is the PROJECT id,
 * which is what WallPro reopens (`/printpro/wallpro?project=`). */
export function wallStudioRow(d: WallStudioDesign): RevisionStudioDesignRow {
  const ready = !!d.job && d.job.status === 'ready';
  return {
    id: d.projectId,
    render_urls: d.artworkUrl ? { hero: d.artworkUrl } : {},
    vehicle_year: null,
    vehicle_make: 'WallPro',
    vehicle_model: d.projectName,
    vehicle_type: 'wall',
    design_file_name: d.projectName,
    color_name: d.projectName,
    color_hex: null,
    finish_type: null,
    mode_type: WALL_MODE,
    pipeline: null,
    created_at: d.createdAt,
    updated_at: d.approvedAt || d.createdAt,
    generation_status: 'completed',
    admin_notes: JSON.stringify({ design_id: d.designId, wallpro: d }),
    custom_design_url: null,
    custom_swatch_url: null,
    custom_styling_prompt_key: null,
    uses_custom_design: false,
    customer_email: null,
    subscription_tier: null,
    organization_id: null,
    infusion_color_id: null,
    lineage_root_id: d.projectId,
    design_id: d.designId,
    order_number: '',
    revision: d.versionNo,
    state: (ready ? 'completed' : d.approved ? 'running' : 'queued') as RevisionStudioDesignRow['state'],
    current_stage: ready ? 'wallpro.panels_ready' : d.approved ? 'wallpro.production' : 'wallpro.design',
  };
}

/** The wall design a grid row carries, or null for a vehicle design. */
export function wallDesignOf(row: { mode_type?: string | null; admin_notes?: string | null } | null | undefined): WallStudioDesign | null {
  if (!row || row.mode_type !== WALL_MODE) return null;
  try {
    const notes = JSON.parse(row.admin_notes || '{}');
    return notes && typeof notes.wallpro === 'object' && notes.wallpro ? notes.wallpro as WallStudioDesign : null;
  } catch { return null; }
}

/** Where WallPro reopens this design, with its photo, versions and panels. */
export const wallProjectPath = (projectId: string) => '/printpro/wallpro?project=' + encodeURIComponent(projectId);
