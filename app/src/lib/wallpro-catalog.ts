// WallPro ready-to-sell catalog: pure contract helpers shared by the batch
// generator (curation) and the customer designer (Pick a design). No I/O here.
//
// Identity model (owner directive, 2026-09-11):
//   DesignID      WPB-0001  permanent commercial identity, assigned by the library.
//   GenerationID  the wallpro_generations row whose master was approved.
//   SynthID       Google's pixel provenance; expected on every master, never a key.
// Rules: docs/wallpro/WALLPRO-BATCH-PRODUCTION-RULES.md
import type { SeamlessReceipt } from './wallpro-seamless';

/** The model the wall Edge handler pins. Locked against the handler by test. */
export const WALL_GENERATION_MODEL = 'gemini-3-pro-image';
export const WALL_CATALOG_PROVIDER = 'google';
export const WALL_CATALOG_PREFIX = 'catalog/';
export const WALL_CATALOG_PROMPT_VERSION = '1';
export type WallCatalogMode = 'repeat' | 'mural';
export type WallIntensity = 'Quiet' | 'Balanced' | 'Statement';
/** A seamless repeat tile the same width as the printed panel would make every
 * panel the identical file. 24 in keeps a 4K tile above 150 PPI today; the
 * curator can widen it once the master has been upscaled. */
export const DEFAULT_TILE_WIDTH_IN = 24;

/** One row of docs/wallpro's 500-prompt library (app/src/data/wallpro-prompt-library.json). */
export type WallPromptEntry = {
  id: string; segment: 'B2B' | 'B2C'; industry: string; room: string; title: string;
  designType: string; style: string; palette: string; intensity: WallIntensity; prompt: string; tags: string[];
};

/** Design types that must tile. Every other type, architectural surfaces
 * included (their library prompts are written to the master-and-panelize
 * contract), is one continuous master sliced with duplicated overlap. */
export const REPEAT_DESIGN_TYPES = ['Seamless Repeat Pattern'] as const;
export function engineForDesignType(designType: string): WallCatalogMode {
  return (REPEAT_DESIGN_TYPES as readonly string[]).includes(designType) ? 'repeat' : 'mural';
}

export type WallCatalogRow = {
  id: string; design_id: string; collection_id: string | null; title: string;
  segment: 'B2B' | 'B2C'; industry: string; room: string | null; design_type: string; style: string | null; palette: string | null; intensity: WallIntensity | null;
  tags: string[]; description: string | null; prompt: string; prompt_version: string; mode: WallCatalogMode; tile_width_in: number | null;
  generation_id: string; provider: string; model: string; synthid_expected: boolean; prompt_hash: string;
  master_path: string; thumb_path: string | null; master_sha256: string; width_px: number; height_px: number; master_version: number;
  seam: SeamlessReceipt | null; approval_status: 'generated' | 'approved' | 'rejected' | 'revision';
  is_active: boolean; sort_order: number; rating: number | null; batch_id: string | null; created_by: string; created_at: string; updated_at: string;
};

/** What one batch job asks the generator for. Repeat tiles are square so the
 * model returns a 1:1 tile; murals use a 3:2 accent wall. */
export function batchDimensions(mode: WallCatalogMode): { width: number; height: number; placement: 'repeat' | 'cover' } {
  return mode === 'repeat' ? { width: 96, height: 96, placement: 'repeat' } : { width: 144, height: 96, placement: 'cover' };
}

export type WallBatchJob = { index: number; entry: WallPromptEntry; mode: WallCatalogMode; referenceIndex: number | null };

export type WallBatchFilter = { segment?: 'B2B' | 'B2C' | 'all'; industry?: string | 'all'; designType?: string | 'all'; intensity?: WallIntensity | 'all' };

/** Library rows matching the batch filter, in catalog order, skipping DesignIDs
 * already published unless the curator asks to regenerate them. */
export function selectLibraryEntries(library: WallPromptEntry[], filter: WallBatchFilter, published: Set<string>, includePublished = false): WallPromptEntry[] {
  return library.filter(e =>
    (!filter.segment || filter.segment === 'all' || e.segment === filter.segment)
    && (!filter.industry || filter.industry === 'all' || e.industry === filter.industry)
    && (!filter.designType || filter.designType === 'all' || e.designType === filter.designType)
    && (!filter.intensity || filter.intensity === 'all' || e.intensity === filter.intensity)
    && (includePublished || !published.has(e.id)));
}

/** Deterministic queue: entries in catalog order, engine from the design type,
 * style examples cycled across jobs so every example conditions an equal share. */
export function planWallBatch(entries: WallPromptEntry[], exampleCount: number): WallBatchJob[] {
  if (!Number.isInteger(exampleCount) || exampleCount < 0) throw new Error('Example count must be a non-negative integer.');
  return entries.map((entry, index) => ({ index, entry, mode: engineForDesignType(entry.designType), referenceIndex: exampleCount ? index % exampleCount : null }));
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha = /^[0-9a-f]{64}$/;
const designId = /^WPB-[0-9A-Z][0-9A-Z-]{3,19}$/;

export function catalogMasterPath(fileId: string, mime: string): string {
  if (!uuid.test(fileId)) throw new Error('Catalog master file id must be a UUID.');
  const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : mime === 'image/png' ? 'png' : null;
  if (!ext) throw new Error('Catalog masters must be PNG, JPEG or WebP.');
  return WALL_CATALOG_PREFIX + fileId + '.' + ext;
}
export function catalogThumbPath(fileId: string): string {
  if (!uuid.test(fileId)) throw new Error('Catalog master file id must be a UUID.');
  return WALL_CATALOG_PREFIX + fileId + '-thumb.jpg';
}
export const CATALOG_THUMB_PX = 640;

export type WallDesignDraft = {
  entry: WallPromptEntry; mode: WallCatalogMode; tileWidthIn?: number | null;
  generationId: string; promptHash: string; masterPath: string; thumbPath?: string | null; masterSha256: string; widthPx: number; heightPx: number;
  seam: SeamlessReceipt | null; rating?: number | null; batchId?: string | null; createdBy: string; collectionId?: string | null;
  /** Existing master_version for this DesignID, when republishing; 0 for a first publish. */
  previousVersion?: number;
};

/** Builds the upsert row and refuses anything the table would refuse, so a
 * bad publish fails in the browser with a reason instead of a constraint name. */
export function designUpsertRow(draft: WallDesignDraft) {
  const e = draft.entry;
  if (!designId.test(e.id)) throw new Error('The library DesignID is invalid: ' + e.id);
  const title = e.title.trim();
  if (!title || title.length > 160) throw new Error('Give the design a title of 1 to 160 characters.');
  if (!e.prompt.trim()) throw new Error('The design prompt is missing.');
  if (!uuid.test(draft.generationId)) throw new Error('The design is not bound to a generation record.');
  if (!sha.test(draft.promptHash) || !sha.test(draft.masterSha256)) throw new Error('The provenance hashes are missing.');
  if (!draft.masterPath.startsWith(WALL_CATALOG_PREFIX)) throw new Error('The master must be copied into the catalog before publishing.');
  if (!(draft.widthPx > 0 && draft.heightPx > 0)) throw new Error('The master pixel size is missing.');
  if (draft.mode !== engineForDesignType(e.designType)) throw new Error(`"${e.designType}" must be published as ${engineForDesignType(e.designType)}.`);
  const tile = draft.mode === 'repeat' ? draft.tileWidthIn ?? DEFAULT_TILE_WIDTH_IN : null;
  if (draft.mode === 'repeat') {
    if (!(tile! >= 1 && tile! <= 2400)) throw new Error('Tile width must be between 1 and 2,400 inches.');
    if (!draft.seam || draft.seam.contract !== 'wallpro.seamless.v1' || !draft.seam.verified) throw new Error('A repeat can only be published with a verified seam. Choose Mirror for this tile or reject it.');
  }
  if (draft.rating != null && !(Number.isInteger(draft.rating) && draft.rating >= 1 && draft.rating <= 5)) throw new Error('Rating must be 1 to 5.');
  const previous = draft.previousVersion ?? 0;
  if (!Number.isInteger(previous) || previous < 0) throw new Error('The previous master version is invalid.');
  return {
    design_id: e.id, title, segment: e.segment, industry: e.industry, room: e.room || null, design_type: e.designType, style: e.style || null,
    palette: e.palette || null, intensity: e.intensity || null, tags: e.tags, description: null,
    prompt: e.prompt, prompt_version: WALL_CATALOG_PROMPT_VERSION, mode: draft.mode, tile_width_in: tile,
    generation_id: draft.generationId, provider: WALL_CATALOG_PROVIDER, model: WALL_GENERATION_MODEL, synthid_expected: true, prompt_hash: draft.promptHash,
    master_path: draft.masterPath, thumb_path: draft.thumbPath || null, master_sha256: draft.masterSha256, width_px: draft.widthPx, height_px: draft.heightPx, master_version: previous + 1,
    seam: draft.mode === 'repeat' ? draft.seam : null, approval_status: 'approved' as const, is_active: true,
    rating: draft.rating ?? null, batch_id: draft.batchId || null, created_by: draft.createdBy, collection_id: draft.collectionId || null,
    updated_at: new Date().toISOString(),
  };
}

/** The provenance passport a product page or a reprint check reads. */
export function provenanceManifest(row: WallCatalogRow) {
  return {
    contract: 'wallpro.provenance.v1',
    design_id: row.design_id, generation_id: row.generation_id, collection_id: row.collection_id,
    segment: row.segment, industry: row.industry, room: row.room, design_type: row.design_type, style: row.style, palette: row.palette, intensity: row.intensity,
    provider: row.provider, model: row.model, synthid_expected: row.synthid_expected,
    prompt_version: row.prompt_version, prompt_hash: row.prompt_hash, master_version: row.master_version,
    master_sha256: row.master_sha256, width_px: row.width_px, height_px: row.height_px,
    mode: row.mode, tile_width_in: row.tile_width_in, seam: row.seam,
    approval_status: row.approval_status, created_at: row.created_at,
  };
}

/** Effective print resolution of a catalog master at its default placement:
 * tile width for repeats, a 144 in accent wall for murals. A 4K master is not
 * 150 PPI because a label says so; only pixels over inches count. */
export function catalogEffectivePpi(row: Pick<WallCatalogRow, 'mode' | 'tile_width_in' | 'width_px' | 'height_px'>): number {
  const inches = row.mode === 'repeat' ? row.tile_width_in ?? DEFAULT_TILE_WIDTH_IN : 144;
  return row.width_px / inches;
}
