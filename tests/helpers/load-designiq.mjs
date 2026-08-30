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
import { buildControlPrompt, resolveEsbuild } from "../../scripts/build-control-prompt.mjs";

const ROOT = resolve(new URL("../..", import.meta.url).pathname);
let cached = null;

export async function loadDesignIQ() {
  if (cached) return cached;
  const work = mkdtempSync(join(tmpdir(), "designiq-"));
  // The builder is imported, not spawned: a child `node` inherits only PATH,
  // and the release gate installs no root node_modules, so pointing PATH at
  // one that does not exist is how this went red in CI while passing locally.
  // resolveEsbuild() searches every workspace the gate DOES install.
  const esbuild = resolveEsbuild();
  buildControlPrompt({ outDir: work, esbuild });
  const out = join(work, "designiq.mjs");
  execFileSync(esbuild, [
    join(work, "control-prompt.ts"),
    "--bundle",
    "--format=esm",
    `--outfile=${out}`,
  ], { stdio: "pipe" });
  cached = await import(pathToFileURL(out).href);
  return cached;
}

export const ATLAS_PANELS = [
  { label: "DRIVER SIDE", surfaceId: "DS", placement: "right-flank" },
  { label: "PASSENGER SIDE", surfaceId: "PS", placement: "left-flank" },
  { label: "HOOD", surfaceId: "HD", placement: "center-column" },
  { label: "ROOF", surfaceId: "RF", placement: "center-column" },
  { label: "FRONT", surfaceId: "FR", placement: "center-column" },
  { label: "REAR", surfaceId: "RR", placement: "center-column" },
];
