// WallPro ready-to-sell catalog: pure contract helpers shared by the batch
// generator (curation) and the customer designer (Pick a design). No I/O here.
//
// Identity model (owner directive, 2026-09-11):
//   DesignID      WPB-0001  permanent commercial identity, assigned by the library.
//   GenerationID  the wallpro_generations row whose master was approved.
//   SynthID       Google's pixel provenance; expected on every master, never a key.
// Rules: docs/wallpro/WALLPRO-BATCH-PRODUCTION-RULES.md
import { seamlessReceipt, type SeamlessReceipt, type SeamReport } from './wallpro-seamless';
// The professional design-domain classifier is the SAME module the edge
// function uses to pick Persona 2 (supabase/functions/generate-wall-design/
// domain.ts) — one classifier, not a second copy that can drift. It is a
// pure, dependency-free module (no Deno API surface), safe to bundle here.
import { classifyWallDomain, type WallDomainClassification } from '../../../supabase/functions/generate-wall-design/domain';

/** The library's per-entry domain/space/style, computed on demand from its
 * existing `industry`/`room`/`style` fields rather than physically stored on
 * the 500-row JSON (owner spec, 2026-09-13, section 5) — one source of
 * truth, no risk of the derived fields drifting from industry/room/style as
 * the library is edited. Curators can still override per job/publish; see
 * `WallDesignDraft.domainOverride` below. */
export function libraryEntryDomain(entry: Pick<WallPromptEntry, 'industry' | 'room' | 'style' | 'segment'>): WallDomainClassification {
  return classifyWallDomain({ prompt: '', libraryIndustry: entry.industry, libraryRoom: entry.room, libraryStyle: entry.style });
}

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

/** One row of docs/wallpro's 500-prompt library (app/src/data/wallpro-prompt-library.json).
 * Its professional-design-engine domain/space/style (owner spec, 2026-09-13)
 * is computed on demand by `libraryEntryDomain` below from `industry`/`room`/
 * `style`, rather than stored as extra fields here: one source of truth,
 * zero risk of a stored classification drifting from the fields it was
 * derived from as the 500-row library is edited. */
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
  /** Saved true-scale room mockups (20260914160000); the storefront shows the first. */
  mockups: { scene_id: string; path: string; caption: string }[];
};

/** The published row's domain/space/style, derived at read time from its
 * already-persisted `industry`/`room`/`style` columns — no schema change, no
 * migration, and no risk of a stored classification drifting from those
 * columns as the classifier improves. Same reasoning as `libraryEntryDomain`
 * above; same underlying classifier. */
export function catalogRowDomain(row: Pick<WallCatalogRow, 'industry' | 'room' | 'style' | 'segment'>): WallDomainClassification {
  return classifyWallDomain({ prompt: '', libraryIndustry: row.industry, libraryRoom: row.room || '', libraryStyle: row.style || '' });
}

/** What one batch job asks the generator for. Repeat tiles are square so the
 * model returns a 1:1 tile; murals use a 3:2 accent wall. */
export function batchDimensions(mode: WallCatalogMode): { width: number; height: number; placement: 'repeat' | 'cover' } {
  return mode === 'repeat' ? { width: 96, height: 96, placement: 'repeat' } : { width: 144, height: 96, placement: 'cover' };
}

export type WallBatchJob = { index: number; entry: WallPromptEntry; mode: WallCatalogMode; referenceIndex: number | null };

export type WallBatchFilter = { segment?: 'B2B' | 'B2C' | 'all'; industry?: string | 'all'; designType?: string | 'all'; intensity?: WallIntensity | 'all'; domain?: 'commercial' | 'residential' | 'all' };

/** Library rows matching the batch filter, in catalog order, skipping DesignIDs
 * already published unless the curator asks to regenerate them. */
export function selectLibraryEntries(library: WallPromptEntry[], filter: WallBatchFilter, published: Set<string>, includePublished = false): WallPromptEntry[] {
  return library.filter(e =>
    (!filter.segment || filter.segment === 'all' || e.segment === filter.segment)
    && (!filter.industry || filter.industry === 'all' || e.industry === filter.industry)
    && (!filter.designType || filter.designType === 'all' || e.designType === filter.designType)
    && (!filter.intensity || filter.intensity === 'all' || e.intensity === filter.intensity)
    && (!filter.domain || filter.domain === 'all' || libraryEntryDomain(e).designDomain === filter.domain)
    && (includePublished || !published.has(e.id)));
}

/** Batch-diversity signal (owner spec, section 8): a batch that converges on
 * one "WallPro house style" is a failure even if every job succeeds. Reports
 * counts, not a pass/fail — the curator judges; this makes convergence
 * visible instead of assumed. `paletteFamily` reads the library's own
 * `palette` string (already free-text, e.g. "sage, ivory and warm taupe") and
 * buckets it on its first named color word, which is coarse on purpose: a
 * repeated exact palette string is the real signal. */
const PALETTE_FAMILY_WORDS = ['sage', 'olive', 'green', 'terracotta', 'blush', 'rust', 'charcoal', 'black', 'ivory', 'cream', 'beige', 'taupe', 'navy', 'blue', 'gold', 'brass', 'bronze', 'pink', 'coral', 'grey', 'gray', 'white', 'brown', 'burgundy', 'teal', 'lavender', 'purple'];
function paletteFamily(palette: string | null | undefined): string {
  const text = (palette || '').toLowerCase();
  return PALETTE_FAMILY_WORDS.find((w) => text.includes(w)) || 'other';
}
export function batchDiversitySummary(entries: WallPromptEntry[]): { count: number; domains: Record<string, number>; styles: Record<string, number>; paletteFamilies: Record<string, number>; designTypes: Record<string, number> } {
  const tally = (values: string[]) => values.reduce<Record<string, number>>((acc, v) => { acc[v] = (acc[v] || 0) + 1; return acc; }, {});
  return {
    count: entries.length,
    domains: tally(entries.map((e) => libraryEntryDomain(e).designDomain)),
    styles: tally(entries.map((e) => e.style || 'unspecified')),
    paletteFamilies: tally(entries.map((e) => paletteFamily(e.palette))),
    designTypes: tally(entries.map((e) => e.designType)),
  };
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

/**
 * The creative brief a batch job actually SENDS to the generator (owner,
 * 2026-09-14: "You need to give better prompts. I need designs like you would
 * see on Etsy").
 *
 * Measured on the 500-row library that day: only 28% of each prompt is
 * design; the other 72% is production-pipeline text ("1-inch duplicated
 * overlap", "150 effective PPI", "never AI-regenerate a panel") that an image
 * model cannot act on, plus eight rotating seam-engineering sentences. The
 * pipeline already enforces every one of those rules in code
 * (wallDesignPrompt states flat/edge-to-edge/no seam marks; the runtime
 * panelizes deterministically), so sending them to the model only dilutes
 * the brief — the same "boilerplate outweighs the design" failure this
 * codebase found in the persona text on 09-12, one layer down.
 *
 * What a boutique wallpaper listing actually carries, and what this builds:
 * SUBJECT (the library's Concept clause, verbatim — the literal intent stays
 * immutable) + MEDIUM/TECHNIQUE (by design type) + MOTIF SCALE (by intensity)
 * + PALETTE and GROUND + MOOD (by style) + the room. The library JSON is not
 * rewritten: `entry.prompt` stays the production-contract record on the
 * published row; this is the model-facing brief derived from it.
 */
const BRIEF_BOILERPLATE_START = /(Create one continuous canonical master|Straight-on flat artwork only|Make it a mathematically seamless|Render it as a flat photorealistic|Generate a minimum 4K)/;
// Owner reference set, 2026-09-14 (five best-seller listings): brushed
// arches on beige, terrazzo, copper line-art leaves on navy, cranes and
// pines on black, a woodblock wave. What every one of them shares — and what
// none of the earlier "painterly / atmospheric" wording asked for — is FLAT
// GRAPHIC PRINT: 2-4 solid colors, bold silhouettes on a solid ground, crisp
// or dry-brush edges, block-print / screen-print / vector rendering. Depth
// comes from layering and line weight, never from shading or photorealism.
// Widened the same day by four more references (toile hummingbirds in one
// ink on cream, a navy/gold hatched ogee lattice, chevron and herringbone
// wood): flat print is EITHER bold silhouettes in 2-4 colors OR fine
// engraved line work in 1-2 colors; photoreal faux material is its own
// family and stays with the two photoreal design types below.
const FLAT_PRINT_CONTRACT = 'Render as flat graphic print artwork — either bold silhouettes in two to four solid colors, or fine engraved / hatched line work in one or two inks (toile, lattice) — with strong contrast against a solid ground (dark grounds welcome), crisp or dry-brush edges, metallic-look line where it fits; depth only from layering and line weight — no gradients, no soft shading, no photorealism, no atmospheric haze.';
const PHOTOREAL_TYPES = new Set(['Photographic Fine Art', 'Architectural Surface']);
const BRIEF_MEDIUM: Record<string, string> = {
  'Painterly Mural': 'hand-brushed strokes as flat graphic marks — dry-brush and gouache texture in solid colors, brush character rather than blended shading',
  'Illustrative Mural': 'flat illustrated block-print / linocut style: confident line, solid color fills',
  'Panoramic Mural': 'a scenic mural in flat illustrated chinoiserie / woodblock style — layered silhouettes, solid fills, a clear horizon',
  'Feature Wall Art': 'one large flat-graphic abstract composition: bold cut-paper shapes, solid colors, screen-print feel',
  'Seamless Repeat Pattern': 'a flat vector / screen-print wallpaper repeat: bold silhouettes in two to four solid colors',
  'Graphic Geometry': 'a flat graphic geometric print with crisp edges, solid colors and a deliberate rhythm',
  'Photographic Fine Art': 'fine-art photographic realism with editorial lighting, as if printed on matte paper',
  'Architectural Surface': 'a flat, photorealistic faux-material texture — chevron or herringbone wood plank, tile with fine grout lines, marble, brick, plaster, stone or limewash — straight-on, with no perspective, corners or lighting hotspots',
};
const BRIEF_SCALE: Record<WallIntensity, string> = {
  Quiet: 'a few very large, calm forms with generous breathing room between them',
  Balanced: 'medium-to-large motifs with a clear hierarchy of one hero element and quieter support',
  Statement: 'bold, oversized hero motifs at dramatic scale',
};
const BRIEF_MOOD: Record<string, string> = {
  'Modern Organic': 'organic modern — soft curves, earthy calm, nothing hard-edged',
  'Quiet Luxury': 'quiet luxury — restrained, tonal, expensive-feeling',
  'Japandi': 'Japandi — warm minimalism, natural materials, negative space as a feature',
  'Dark Luxe': 'moody and dramatic, deep saturated tones, luxurious',
  'Contemporary Editorial': 'contemporary editorial — magazine-clean, confident, current',
  'Architectural Minimalism': 'architectural minimalism — structure over decoration, exact and calm',
  'Painterly Fine Art': 'painterly fine art — loose, expressive, gallery-worthy',
  'Photorealistic Fine Art': 'photorealistic fine art — lush, tactile, high-end print',
  'Material-Driven Luxury': 'material-driven luxury — the surface itself is the design: stone, brass, plaster, wood',
  'Modern Geometric': 'modern geometric — clean, rhythmic, mid-century confidence',
  'Moody Botanical': 'moody botanical — dark ground, rich foliage, romantic and dramatic',
  'Panoramic Atmospheric': 'panoramic and atmospheric — a horizon, depth, soft light',
  'Sculptural Neutral': 'sculptural neutral — bas-relief feel in warm neutrals',
  'Warm Contemporary': 'warm contemporary — inviting, layered, current',
  'Biophilic Contemporary': 'biophilic contemporary — living greenery, natural light, restorative',
  'Art Deco Contemporary': 'contemporary art deco — geometric glamour, brass and velvet tones',
  'Graphic Modern': 'graphic modern — bold shapes, flat color, poster-clean',
};
export function batchCreativeBrief(entry: Pick<WallPromptEntry, 'prompt' | 'designType' | 'style' | 'palette' | 'intensity' | 'room' | 'industry' | 'segment'>): string {
  const head = entry.prompt.split(BRIEF_BOILERPLATE_START)[0];
  const concept = (head.match(/Concept:\s*(.*?)\.\s*Visual language:/)?.[1] || head.replace(/^Create an? .*? market\.\s*/, '').split('.')[0]).trim();
  const medium = BRIEF_MEDIUM[entry.designType] || 'a hand-made, original wallcovering design';
  const scale = BRIEF_SCALE[entry.intensity] || BRIEF_SCALE.Balanced;
  const mood = BRIEF_MOOD[entry.style] || entry.style;
  const domain = libraryEntryDomain(entry).designDomain;
  const setting = domain === 'residential' ? `for a ${entry.room.toLowerCase()} in a home` : `for the ${entry.room.toLowerCase()} of a ${entry.industry.replace(/ & /g, ' / ')} business`;
  // The library lists four colors with no ground named; guessing one (the
  // first entry was "cobalt accent" on WPB-0007) is a false instruction, so
  // the brief gives the designer the rule instead of a guess.
  return [
    `${concept.charAt(0).toUpperCase() + concept.slice(1)} — ${medium}.`,
    `Scale: ${scale}.`,
    `Palette: ${entry.palette}; the quietest of these is the ground, the boldest the accent.`,
    `Mood: ${mood}.`,
    PHOTOREAL_TYPES.has(entry.designType) ? '' : FLAT_PRINT_CONTRACT,
    `Designed ${setting}, to sell as a premium original wallpaper / mural listing: cohesive, print-made character, nothing generic or clip-art.`,
  ].filter(Boolean).join(' ');
}

/**
 * The batch seam ladder (owner, 2026-09-14: "Seamless", and the standing
 * contract "seamless is measured and closed by code, never by re-asking the
 * model"). A tile that measures seamless publishes as generated. One that
 * does not is closed by BLEND first — the deterministic crossfaded outer
 * frame keeps every motif upright — and by MIRROR only when the blend still
 * does not measure clean. Mirror flips alternate tiles, which is invisible on
 * abstract texture and plainly wrong on cranes, leaves or lettering; it used
 * to be the only fallback.
 */
export function batchSeamDecision(before: SeamReport, blendedAfter: SeamReport | null): SeamlessReceipt {
  if (before.seamless) return seamlessReceipt('auto', before, null, 'verified');
  if (blendedAfter?.seamless) return seamlessReceipt('auto', before, blendedAfter, 'blend');
  return seamlessReceipt('auto', before, null, 'mirror');
}

/** Effective print resolution of a catalog master at its default placement:
 * tile width for repeats, a 144 in accent wall for murals. A 4K master is not
 * 150 PPI because a label says so; only pixels over inches count. */
export function catalogEffectivePpi(row: Pick<WallCatalogRow, 'mode' | 'tile_width_in' | 'width_px' | 'height_px'>): number {
  const inches = row.mode === 'repeat' ? row.tile_width_in ?? DEFAULT_TILE_WIDTH_IN : 144;
  return row.width_px / inches;
}
