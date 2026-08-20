/**
 * THE CUSTOMER PATH MAY NOT REACH THE RESTYLEPRO PRODUCTION BACKEND.
 *
 * This is not a checklist of migration steps. It is a condition that has to be
 * true for the branch to be a DesignPro restore at all.
 *
 * A half-migrated UI is worse than an unmigrated one. It compiles, it renders,
 * it looks restored -- and then one code path reaches back into edge functions
 * and tables the standalone runtime does not own, so a design acquires a second
 * identity, or a proof comes from a producer nobody audited, and none of it
 * shows up as an error. The whole point of the standalone runtime is that there
 * is exactly one authority for Calls 8-12; a customer path with a second door
 * into the old one does not have that property no matter how much of it was
 * ported.
 *
 * So reachability is the test, not intent and not file count. Starting from the
 * routes a signed-in customer can actually open, follow every import. If any
 * module in that closure names a RestylePro production edge function, an Entice
 * symbol, or one of the legacy design tables, the seam is open.
 *
 * WHAT THIS DELIBERATELY DOES NOT ASSERT. It says nothing about files that
 * merely exist. Unrouted legacy pages are dead weight to be removed on their
 * own schedule; they are not a danger, because nothing a customer clicks can
 * get to them. Existence is a tidiness question. Reachability is the contract.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "app", "src");
const EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"];

/**
 * Every page a signed-in customer can open under the restored DesignPro UI.
 * Adding a route to App.tsx that a customer can reach means adding it here --
 * a new customer surface is exactly what this is meant to cover.
 */
const CUSTOMER_ROUTE_MODULES = [
  "pages/DesignProAIHome.tsx",
  "pages/DesignPanelProPremium.tsx",
  "pages/designpro/GenerateDesign.tsx",
  "pages/designpro/ProductionJobs.tsx",
  "pages/designpro/ProductionWorkflow.tsx",
  "pages/designpro/GenieQc.tsx",
  "pages/designpro/NewRevisionSource.tsx",
  "pages/designpro/WrapBoxDelivery.tsx",
  "pages/PanelSizer.tsx",
  "pages/DesignStudio.tsx",
  "pages/DesignProStudio.tsx",
];

/**
 * RestylePro production edge functions. Naming one is enough -- a string is how
 * every one of these gets invoked, and a name sitting in a customer-path module
 * is a door someone will open.
 */
const PRODUCTION_FUNCTIONS = [
  "design-panel-ai-generate", "generate-color-render", "generate-2d-proof",
  "compose-2d-proof", "designpro-parse-brief", "designpro-text-layer-generate",
  "designpro-persist-assets", "designpro-clean-views", "designpro-separate",
  "designpro-artboard", "designpro-orchestrate", "designpro-file-output-api",
  "designpro-flat-art", "designpro-recreate-3d", "designpro-ensure-qc-job",
  "panel-artboard-generator", "panel-pro-extract", "panelize-artboard",
  "panelizer-step-validate", "panelizer-step-proof", "panelizer-step-package",
  "save-production-panels", "production-flow-engine", "run-production-flow",
  "extract-logo-elements", "layerlift-engine", "activate-print-worker",
  "upscale-panel-to-print", "upscale-production-file", "deploy-to-wrapbox",
  "generate-production-files", "qc-generate-flat-artboard", "revise-render",
  "auto-generate-artboard", "generate-artboard-from-proof",
];

/** The Entice pack, and the legacy tables a design used to be assembled from. */
const LEGACY_SYMBOLS = [
  "getEnticeRevisionStatus", "saveEnticeRevision", "resumeEnticeRevision",
  "submitEnticeRevision", "activeEnticePack", "previewProofUrl",
  "production_flow_assets", "designiq_generations", "color_visualizations",
];

function resolveImport(specifier, fromFile) {
  let base;
  if (specifier.startsWith("@/")) base = join(ROOT, specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(fromFile), specifier);
  else return null;
  for (const extension of EXTENSIONS) {
    const candidate = base + extension;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const IMPORT_PATTERN =
  /(?:^|[\s;])(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/gms;

function customerReachableModules() {
  const seen = new Set();
  const queue = CUSTOMER_ROUTE_MODULES.map((relative) => join(ROOT, relative));
  for (const entry of queue) {
    assert.ok(existsSync(entry), `customer route module is missing: ${entry}`);
  }
  while (queue.length) {
    const file = queue.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    for (const match of readFileSync(file, "utf8").matchAll(IMPORT_PATTERN)) {
      const target = resolveImport(match[1] || match[2], file);
      if (target && !seen.has(target)) queue.push(target);
    }
  }
  return [...seen].sort();
}

/**
 * Comments are prose, not behaviour. A note explaining why a path was retired
 * is exactly what a future session needs to avoid restoring it, so stripping
 * comments before scanning is what keeps this gate from punishing the record.
 */
function executableCode(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => (/^\s*(\/\/|\*)/.test(line) ? "" : line.replace(/\/\/.*$/, "")))
    .join("\n");
}

/**
 * The generated Supabase type file describes every table in the project, this
 * system's and the legacy one's alike. It is a schema dump, not a call site,
 * and it is regenerated rather than authored.
 */
const NOT_BEHAVIOUR = new Set([join(ROOT, "integrations/supabase/types.ts")]);

function violations() {
  const found = [];
  for (const file of customerReachableModules()) {
    if (NOT_BEHAVIOUR.has(file)) continue;
    const relative = file.replace(`${ROOT}/`, "");
    executableCode(readFileSync(file, "utf8"))
      .split("\n")
      .forEach((line, index) => {
        for (const name of PRODUCTION_FUNCTIONS) {
          if (line.includes(`"${name}"`) || line.includes(`'${name}'`)) {
            found.push(`${relative}:${index + 1} names the RestylePro function "${name}"`);
          }
        }
        for (const symbol of LEGACY_SYMBOLS) {
          if (new RegExp(`\\b${symbol}\\b`).test(line)) {
            found.push(`${relative}:${index + 1} uses the legacy symbol "${symbol}"`);
          }
        }
      });
  }
  return found;
}

test("the customer path reaches every DesignPro route it is supposed to cover", () => {
  const reachable = customerReachableModules();
  // A walker that silently resolved nothing would make every assertion below
  // pass by covering an empty graph.
  assert.ok(
    reachable.length > 100,
    `only ${reachable.length} modules were reachable — the import walk is not resolving`,
  );
  assert.ok(
    reachable.some((file) => file.endsWith("lib/designpro-api.ts")),
    "the standalone gateway client is not reachable from the customer path",
  );
});

test("no customer-reachable module touches the RestylePro production backend", () => {
  const found = violations();
  assert.deepEqual(
    found,
    [],
    `The customer path can still reach the old production backend:\n  ${found.join("\n  ")}`,
  );
});
