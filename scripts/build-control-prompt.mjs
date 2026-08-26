#!/usr/bin/env node
/**
 * Transpile the CONTROL creative engine into a runnable ESM module.
 *
 * The control is `supabase/functions/design-panel-ai-generate/index.ts` — a
 * Deno/TypeScript edge function. The A/B parity harness has to call its real
 * prompt builders, not a re-description of them, so this slices the pure
 * prompt-building half of that file (everything above the `serve()` handler),
 * swaps its Deno imports for the three local modules it actually needs, and
 * bundles it with esbuild.
 *
 * NOTHING IS REWRITTEN. The slice is byte-for-byte the deployed source; only
 * the import header is replaced, because `serve`, `createClient`, `tokenGate`,
 * `captureDesignDNA`, `getGeminiKey` and `emitRenderEvent` are transport and
 * persistence concerns that the prompt builders never call.
 *
 * `scripts/designiq-ab-precision.mjs` asserts the resulting prompt hash against
 * the same builder run from the restylepro-os checkout, so a drifted vendored
 * copy fails the run rather than quietly becoming "the control".
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

// The last line of the pure region. `serve(` opens the request handler; every
// prompt builder is above it.
function pureRegionEnd(source) {
  const index = source.indexOf("\nserve(async (req)");
  if (index < 0) throw new Error("control source no longer contains the serve() boundary");
  return index;
}

export function buildControlPrompt({ outDir, esbuild = "esbuild" }) {
  mkdirSync(outDir, { recursive: true });
  const fns = join(REPO, "supabase", "functions");

  copyFileSync(join(fns, "_shared", "studio-os.ts"), join(outDir, "studio-os.ts"));
  copyFileSync(join(fns, "_shared", "view-angles-os.ts"), join(outDir, "view-angles-os.ts"));

  // canonicalizeVehicle + its titleCase helper, without emitRenderEvent's
  // supabase-js import.
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
  const pure = source.slice(0, pureRegionEnd(source)).replace(/^import .*?;\s*$/gms, "");
  writeFileSync(
    join(outDir, "control-prompt.ts"),
    'import { STUDIO_ENVIRONMENT } from "./studio-os.ts";\n'
    + 'import { getCameraAngle, getAspectRatio, getResolution } from "./view-angles-os.ts";\n'
    + 'import { canonicalizeVehicle } from "./render-events-slice.ts";\n'
    + pure
    + "\nexport { buildDesignIQPrompt, briefWantsPhoto, splitStyleAndText };\n",
  );

  const out = join(outDir, "control-prompt.mjs");
  execFileSync(esbuild, [
    join(outDir, "control-prompt.ts"),
    "--bundle", "--format=esm", "--platform=node", `--outfile=${out}`, "--log-level=warning",
  ], { stdio: "inherit" });
  return out;
}

if (process.argv[1] && process.argv[1].endsWith("build-control-prompt.mjs")) {
  const outDir = process.argv[2] || join(REPO, ".control-build");
  const esbuild = process.env.ESBUILD_BIN || "esbuild";
  console.log(buildControlPrompt({ outDir, esbuild }));
}
