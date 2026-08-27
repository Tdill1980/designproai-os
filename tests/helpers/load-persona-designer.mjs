// Executes the REAL pinned Persona-2 designer builder in tests. The TS source
// (restylepro-os 113d137, byte-exact in supabase/functions/_shared) is
// transpiled mechanically — never re-typed — so every assertion runs against
// the exact creative authority the deployed edge function executes.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(new URL("../..", import.meta.url).pathname);
const SHARED = join(ROOT, "supabase", "functions", "_shared");

let cached = null;

export async function loadPersonaDesigner() {
  if (cached) return cached;
  const work = mkdtempSync(join(tmpdir(), "persona-designer-"));
  // The persona file imports studio-os and view-angles-os with .ts specifiers;
  // esbuild resolves them from the copied directory unchanged.
  for (const name of ["atlas-artboard-prompt.ts", "persona-designer-prompt.ts", "studio-os.ts", "view-angles-os.ts"]) {
    writeFileSync(join(work, name), readFileSync(join(SHARED, name)));
  }
  const out = join(work, "atlas-artboard-prompt.mjs");
  execFileSync(join(ROOT, "node_modules", ".bin", "esbuild"), [
    join(work, "atlas-artboard-prompt.ts"),
    "--bundle",
    "--format=esm",
    `--outfile=${out}`,
  ], { stdio: "pipe" });
  const persona = join(work, "persona-designer-prompt.mjs");
  execFileSync(join(ROOT, "node_modules", ".bin", "esbuild"), [
    join(work, "persona-designer-prompt.ts"),
    "--bundle",
    "--format=esm",
    `--outfile=${persona}`,
  ], { stdio: "pipe" });
  cached = { ...(await import(pathToFileURL(persona).href)), ...(await import(pathToFileURL(out).href)) };
  return cached;
}
