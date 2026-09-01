/**
 * THE CALL-1 REGIONS THAT MAY NOT MOVE.
 *
 * `design-panel-ai-generate/index.ts` hosts two structurally isolated branches:
 * A.T.L.A.S. AUTHORING (creative) and A.T.L.A.S. PROOF PRESENTATION. Adding the
 * second one changes the file, so a whole-file hash cannot prove the first one
 * is untouched. This slices the authoring regions by name and hashes each, so
 * "the creative branch is byte-identical" is a measurement rather than a claim.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const CALL_ONE_REGIONS = [
  "const ATLAS_ARTBOARD_AUTHORING_MODEL",
  "const ATLAS_ARTBOARD_PROMPT_VERSION",
  "const ATLAS_ARTBOARD_SOURCE_COMMIT",
  "const ATLAS_ARTBOARD_MODEL_REQUEST_MAX_BYTES",
  "function atlasFinishSpec",
  "function buildDesignIQPrompt",
  "async function handleAtlasArtboard",
];

/** Slice from a declaration to its balanced close (or end of line for a const). */
export function sliceRegion(source, declaration) {
  const start = source.indexOf(declaration);
  if (start < 0) throw new Error(`region not found: ${declaration}`);
  if (declaration.startsWith("const ")) {
    const end = source.indexOf("\n", start);
    return source.slice(start, end < 0 ? source.length : end);
  }
  const open = source.indexOf("{", start);
  if (open < 0) throw new Error(`no body: ${declaration}`);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced body: ${declaration}`);
}

export function regionHashes(file) {
  const source = readFileSync(file, "utf8");
  const out = {};
  for (const region of CALL_ONE_REGIONS) {
    out[region] = createHash("sha256").update(sliceRegion(source, region)).digest("hex").slice(0, 16);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2] || "supabase/functions/design-panel-ai-generate/index.ts";
  for (const [region, hash] of Object.entries(regionHashes(file))) {
    console.log(`${hash}  ${region}`);
  }
}
