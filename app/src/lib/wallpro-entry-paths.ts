/**
 * THE WAYS INTO A WALL DESIGN — AND WHICH OF THEM HAVE ANYTHING BEHIND THEM.
 *
 * Owner, 2026-09-18, before a partner demo: hide "Pick a design" while the
 * ready-made catalog is empty.
 *
 * MEASURED, not assumed: `wallpro_designs` holds 0 rows in designproai-os-prod
 * and `wallpro_catalog_scenes` holds 0, so the catalog read
 * (`is_active = true AND approval_status = 'approved'`) can only ever return
 * nothing. "Pick a design" therefore offered a PRICED path that opened on
 * "No ready-to-sell designs are published yet" — the customer chose before
 * finding out there was nothing to choose from. The tool was behaving exactly
 * as written; the catalog was simply never curated.
 *
 * THE REVEAL IS ONE-WAY, DELIBERATELY. The option appears only once rows are
 * actually in hand — `catalog` non-null AND non-empty — and never during the
 * load. Showing it and then taking it away is the flicker that reads as a bug;
 * a path that is simply not offered reads as a product with four ways in. The
 * moment /admin/wallpro-batch publishes and approves one design, it returns
 * with no deploy.
 *
 * This is a pure function so the rule is testable without mounting the tool.
 * The four always-on paths need no data: match and wall take the customer's own
 * upload, prompt takes their words, and print-ready takes their file.
 */
export type WallEntryMode = 'library' | 'match' | 'wall' | 'ai' | 'upload';

export type WallEntryPath = {
  mode: WallEntryMode;
  label: string;
  hint: string;
};

/** The four paths that are always available: none of them reads a published row. */
export const WALL_SELF_SERVE_PATHS: readonly WallEntryPath[] = [
  { mode: 'match', label: 'Match my design', hint: 'Upload a design; it is recreated print-ready, with any changes you ask for.' },
  { mode: 'wall', label: 'Design for my wall', hint: 'Upload your wall photo and let the designer propose a design for that room.' },
  { mode: 'ai', label: 'Describe a design', hint: 'Prompt only: a mural or a repeating pattern.' },
  { mode: 'upload', label: 'Use my print-ready file', hint: 'Your own file, placed as supplied. It must meet the print resolution.' },
];

/** The catalog path, offered only when the catalog can actually answer it. */
export const WALL_LIBRARY_PATH: WallEntryPath = {
  mode: 'library',
  label: 'Pick a design',
  hint: 'Ready-to-print designs by industry. No token.',
};

/**
 * @param catalogCount rows in hand, or `null` while the catalog is still loading.
 */
export function wallEntryPaths(catalogCount: number | null): WallEntryPath[] {
  const offerLibrary = typeof catalogCount === 'number' && catalogCount > 0;
  return offerLibrary ? [WALL_LIBRARY_PATH, ...WALL_SELF_SERVE_PATHS] : [...WALL_SELF_SERVE_PATHS];
}

/**
 * A restored project can name a mode this catalog no longer offers (saved when
 * designs were published, or carried over from another project). Fall back to
 * the prompt path rather than leaving the customer on a grid with nothing in
 * it. Returns the mode to use, so the caller only writes state when it changes.
 */
export function resolvedWallEntryMode(mode: WallEntryMode, catalogCount: number | null): WallEntryMode {
  if (mode === 'library' && catalogCount === 0) return 'ai';
  return mode;
}
