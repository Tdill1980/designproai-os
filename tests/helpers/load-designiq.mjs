// Executes the REAL DPAG creative assembly in tests. scripts/build-control-prompt.mjs
// slices the pure prompt half of the deployed
// supabase/functions/design-panel-ai-generate/index.ts (never re-describes it)
// and esbuild bundles it, so every assertion below runs against the exact
// buildDesignIQPrompt the edge function executes — including its
// atlasFlatMaster branch.
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(new URL("../..", import.meta.url).pathname);
let cached = null;

export async function loadDesignIQ() {
  if (cached) return cached;
  const work = mkdtempSync(join(tmpdir(), "designiq-"));
  execFileSync("node", [join(ROOT, "scripts", "build-control-prompt.mjs"), work], {
    cwd: ROOT,
    stdio: "pipe",
    // build-control-prompt shells out to `esbuild`; the repo's copy lives in
    // node_modules/.bin and is not on PATH in a bare test run.
    env: { ...process.env, PATH: `${join(ROOT, "node_modules", ".bin")}:${process.env.PATH}` },
  });
  const out = join(work, "designiq.mjs");
  execFileSync(join(ROOT, "node_modules", ".bin", "esbuild"), [
    join(work, "control-prompt.ts"),
    "--bundle",
    "--format=esm",
    `--outfile=${out}`,
  ], { stdio: "pipe" });
  cached = await import(pathToFileURL(out).href);
  return cached;
}

export const ATLAS_PANELS = [
  { label: "DRIVER SIDE", widthInches: 153, heightInches: 56 },
  { label: "PASSENGER SIDE", widthInches: 153, heightInches: 56 },
  { label: "HOOD", widthInches: 71.5, heightInches: 56 },
  { label: "ROOF", widthInches: 74.3, heightInches: 54.8 },
  { label: "FRONT", widthInches: 129, heightInches: 34 },
  { label: "REAR", widthInches: 76, heightInches: 54 },
];
