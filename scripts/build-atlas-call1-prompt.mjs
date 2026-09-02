#!/usr/bin/env node
/**
 * Lift the DEPLOYED Call-1 assembly out of design-panel-ai-generate/index.ts
 * so a harness can execute it instead of re-describing it.
 *
 * `build-control-prompt.mjs` already slices that file's pure prompt region for
 * the creative-parity A/B. This does the same job for the A.T.L.A.S. branch,
 * which lives BELOW the serve() boundary and therefore outside that slice:
 *
 *   buildAtlasCall1Prompt(body)  the exact `const vehicleYear …` →
 *                                `buildDesignIQPrompt({…} as any)` region,
 *                                extracted verbatim by anchor and wrapped
 *   TEACHING_REFERENCE_TEXT      the teaching-proof text part, verbatim
 *   TARGET_GUIDE_TEXT            the neutral-guide text part, verbatim
 *   AUTHORING_MODEL              the pinned Call-1 image model
 *   MODEL_REQUEST_MAX_BYTES      the request ceiling the edge enforces
 *
 * NOTHING IS REWRITTEN, and nothing here is allowed to guess: every extractor
 * fails the build when its anchor is missing or ambiguous. A harness that
 * silently falls back to a re-typed prompt is not measuring production.
 *
 * It writes to its own output directory and does not touch
 * build-control-prompt.mjs, so the precision A/B's pinned control slice is
 * unaffected.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveEsbuild } from "./build-control-prompt.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

const REGION_START = '    const vehicleYear = String(body.vehicleYear || "").trim();';
const REGION_END = "    } as any);";

function once(source, needle, what) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`atlas call-1 slice: ${what} anchor not found`);
  if (source.indexOf(needle, first + 1) >= 0) throw new Error(`atlas call-1 slice: ${what} anchor is ambiguous`);
  return first;
}

function literalAfter(source, marker, what) {
  const at = once(source, marker, what);
  const openQuote = source.lastIndexOf('"', at);
  if (openQuote < 0) throw new Error(`atlas call-1 slice: ${what} literal has no opening quote`);
  const closeQuote = source.indexOf('",', at);
  if (closeQuote < 0) throw new Error(`atlas call-1 slice: ${what} literal is unterminated`);
  const raw = source.slice(openQuote, closeQuote + 1);
  const value = JSON.parse(raw);
  if (!value.startsWith(marker.slice(0, 24))) throw new Error(`atlas call-1 slice: ${what} literal did not start where expected`);
  return value;
}

function constant(source, name) {
  const match = new RegExp(`^const ${name} = (.+);$`, "m").exec(source);
  if (!match) throw new Error(`atlas call-1 slice: ${name} is no longer a top-level const`);
  return match[1];
}

export function buildAtlasCall1Prompt({ outDir, esbuild = "esbuild" }) {
  mkdirSync(outDir, { recursive: true });
  const fns = join(REPO, "supabase", "functions");
  copyFileSync(join(fns, "_shared", "studio-os.ts"), join(outDir, "studio-os.ts"));
  copyFileSync(join(fns, "_shared", "view-angles-os.ts"), join(outDir, "view-angles-os.ts"));

  const events = readFileSync(join(fns, "_shared", "render-events.ts"), "utf8").split("\n");
  const start = events.findIndex((line) => line.startsWith("export function canonicalizeVehicle("));
  if (start < 0) throw new Error("render-events.ts no longer exports canonicalizeVehicle");
  const tail = events.slice(start).join("\n");
  const titleCaseEnd = tail.indexOf("\nfunction titleCase(");
  const afterTitleCase = tail.slice(titleCaseEnd + 1);
  const titleCaseClose = afterTitleCase.indexOf("\n}\n");
  writeFileSync(
    join(outDir, "render-events-slice.ts"),
    tail.slice(0, titleCaseEnd + 1) + afterTitleCase.slice(0, titleCaseClose + 3),
  );

  const source = readFileSync(join(fns, "design-panel-ai-generate", "index.ts"), "utf8");
  const serveAt = once(source, "\nserve(async (req)", "serve() boundary");
  const pure = source.slice(0, serveAt).replace(/^import .*?;\s*$/gms, "");

  const regionStart = once(source, REGION_START, "Call-1 assembly start");
  const regionEnd = source.indexOf(REGION_END, regionStart);
  if (regionEnd < 0) throw new Error("atlas call-1 slice: Call-1 assembly end anchor not found");
  const region = source.slice(regionStart, regionEnd + REGION_END.length);
  if (!region.includes("buildDesignIQPrompt({")) throw new Error("atlas call-1 slice: extracted region does not call buildDesignIQPrompt");
  if (!region.includes("atlasFlatMaster: true")) throw new Error("atlas call-1 slice: extracted region is not the flat-master branch");

  const teachingText = literalAfter(source, "LABELED A.T.L.A.S. TEACHING REFERENCE.", "teaching reference text");
  const guideText = literalAfter(source, "CURRENT TARGET GUIDE —", "target guide text");

  const sliced = join(outDir, "atlas-call1-prompt.ts");
  writeFileSync(
    sliced,
    'import { STUDIO_ENVIRONMENT } from "./studio-os.ts";\n'
    + 'import { getCameraAngle, getAspectRatio, getResolution } from "./view-angles-os.ts";\n'
    + 'import { canonicalizeVehicle } from "./render-events-slice.ts";\n'
    + pure
    + "\n// ── EXTRACTED VERBATIM FROM handleAtlasArtboard ──────────────────────────\n"
    + "export function buildAtlasCall1Prompt(body: Record<string, unknown>) {\n"
    + region
    + "\n  return { prompt, panels, references };\n}\n"
    + `export const TEACHING_REFERENCE_TEXT = ${JSON.stringify(teachingText)};\n`
    + `export const TARGET_GUIDE_TEXT = ${JSON.stringify(guideText)};\n`
    + `export const AUTHORING_MODEL = ${constant(source, "ATLAS_ARTBOARD_AUTHORING_MODEL")};\n`
    + `export const MODEL_REQUEST_MAX_BYTES = ${constant(source, "ATLAS_ARTBOARD_MODEL_REQUEST_MAX_BYTES")};\n`
    + "export { buildDesignIQPrompt };\n",
  );

  const out = join(outDir, "atlas-call1-prompt.mjs");
  execFileSync(esbuild, [
    sliced, "--bundle", "--format=esm", "--platform=node", `--outfile=${out}`, "--log-level=warning",
  ], { stdio: "inherit" });
  return out;
}

if (process.argv[1] && process.argv[1].endsWith("build-atlas-call1-prompt.mjs")) {
  const outDir = process.argv[2] || join(REPO, ".atlas-call1-build");
  console.log(buildAtlasCall1Prompt({ outDir, esbuild: resolveEsbuild() }));
}
