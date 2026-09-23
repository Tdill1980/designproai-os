/**
 * The catalog batch's ONE source of catalog rules, re-exported for bundling.
 *
 * `scripts/wallpro-catalog-batch.mjs` runs on the droplet, outside the app, and
 * it must not carry its own copy of what a publishable row is. Everything it
 * needs is exported from the app's own modules here and bundled with esbuild,
 * so `designUpsertRow` -- the function that refuses a row the table would
 * refuse -- is literally the same function the admin batch page calls.
 *
 * This file adds NO logic on purpose. If the runner ever needs a rule that is
 * not exported below, export it; do not reimplement it in the runner. A second
 * definition of "what a catalog row is" is the second-producer shape RULE 0.21
 * forbids, and this indirection exists precisely to make that impossible.
 */
export { WALL_PRESETS, presetAsEntry } from '../app/src/data/wallpro-presets';
export {
  designUpsertRow,
  catalogMasterPath,
  catalogThumbPath,
  briefForEntry,
  batchDimensions,
  engineForDesignType,
  selectLibraryEntries,
  planWallBatch,
  libraryEntryDomain,
  batchDiversitySummary,
  CATALOG_THUMB_PX,
  DEFAULT_TILE_WIDTH_IN,
} from '../app/src/lib/wallpro-catalog';
export {
  measureSeam,
  blendSeamless,
  seamLadder,
  shouldTryBlend,
  seamlessReceipt,
} from '../app/src/lib/wallpro-seamless';
