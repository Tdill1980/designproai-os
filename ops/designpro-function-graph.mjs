#!/usr/bin/env node
/**
 * Which edge functions the DesignPro chain actually calls -- computed, not asserted.
 *
 * The migrated frontend carries every RestylePro product (WallPro, GraphicsPro,
 * ColorPro, the marketing and video tools), so "the functions the app invokes"
 * is roughly four hundred names and is not a DesignPro answer. This walks the
 * DesignPro chain only: the pages, hooks and libraries that run a design from
 * brief through proof, panels, QC and delivery, then follows every
 * function-to-function call out from there until the set closes.
 *
 * Every name it emits therefore carries a caller. A function nothing in the
 * chain reaches is not in the set, which is the property the droplet's routing
 * allowlist depends on -- see ops/designpro-functions.txt.
 *
 *   node ops/designpro-function-graph.mjs           # print the graph
 *   node ops/designpro-function-graph.mjs --check   # fail if the allowlist drifted
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FUNCTIONS = path.join(ROOT, "supabase/functions");
const ALLOWLIST = path.join(ROOT, "ops/designpro-functions.txt");

/**
 * The DesignPro chain's entry points. Each is a file that a customer's design
 * passes through: the brief, the seven views, the revision studio, the 2D
 * proof, the entice panels, the production pack, the QC board.
 */
const SEED_FILES = [
  "app/src/hooks/useDesignPanelProLogic.ts",
  "app/src/hooks/useQuickProductionPack.ts",
  "app/src/lib/designpro-file-output.ts",
  "app/src/lib/enticePanelsFromProof.ts",
  "app/src/lib/flatMasterSheet.ts",
  "app/src/lib/generateDisplaySafe2DProof.ts",
  "app/src/pages/AdminGeminiCompareStudio.tsx",
  "app/src/pages/DesignPanelProPremium.tsx",
  "app/src/pages/ProductionFlow.tsx",
  "app/src/pages/RevisionStudioIQ.tsx",
];

/**
 * Ingress the browser cannot show. The back half of the chain is entered by
 * Stripe, by the Railway worker calling back, by a resume of a durable workflow
 * and by the delivery leg - none of which appear as a call expression in a page.
 * Recovering `activate-print-worker` from the application's own BUSY_FNS was
 * never proof that the rest were captured, so every server-side entry point the
 * chain has is named here and closed over like any other seed.
 */
const SERVER_SEEDS = [
  // Payment. The production-pack webhook only -- restylepro-os's shared
  // stripe-webhook also settles affiliates, marketplace orders, tokens and
  // subscriptions, and seeding it drags four unrelated products and their
  // schemas into a droplet that hosts none of them.
  "productionflow-stripe-webhook",
  // Orchestration and the durable workflow's own resume path.
  "designpro-file-output-api",
  "run-production-flow",
  "production-flow-engine",
  // The print worker leg: kick, per-panel upscale, QC job, panel validation.
  "activate-print-worker",
  "upscale-production-pack",
  "designpro-ensure-qc-job",
  "qa-check-production-panel",
  "qa-validate-panels",
  // Packaging and delivery: ZIP, WrapBox push, and the customer's download.
  "package-production-files",
  "deploy-to-wrapbox",
  "get-public-pack",
  "get-signed-urls",
];

const SEED_DIRS = [
  "app/src/components/designpanelpro",
  "app/src/components/designpro",
  "app/src/components/production",
  "app/src/components/productionflow",
  "app/src/components/revisioniq",
  "app/src/pages/designpro",
];

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SOURCE_EXT.test(entry.name)) out.push(full);
  }
  return out;
}

function isFunction(name) {
  return fs.existsSync(path.join(FUNCTIONS, name, "index.ts"));
}

/** Both call shapes the codebase uses: the client helper and the raw URL. */
function referencedFunctions(text) {
  const found = new Set();
  const invoke = /functions\s*\.\s*invoke\s*\(\s*["'`]([a-z0-9][a-z0-9-]*)["'`]/g;
  const url = /\/functions\/v1\/([a-z0-9][a-z0-9-]*)/g;
  let match;
  while ((match = invoke.exec(text))) found.add(match[1]);
  while ((match = url.exec(text))) found.add(match[1]);
  return found;
}

/**
 * The back half runs on a Stripe webhook and a durable workflow, not on a click,
 * so two of its functions are named by no call expression the scanner can see.
 * The application declares them itself -- client.ts holds the set of pipeline
 * functions whose in-flight calls defer a deploy reload -- and that declaration
 * is read rather than duplicated here, so the two lists cannot disagree.
 */
function declaredPipelineFunctions() {
  const source = fs.readFileSync(path.join(ROOT, "app/src/integrations/supabase/client.ts"), "utf8");
  const block = source.match(/const BUSY_FNS = new Set\(\[([\s\S]*?)\]\)/);
  if (!block) throw new Error("client.ts no longer declares BUSY_FNS");
  return [...block[1].matchAll(/['"]([a-z0-9][a-z0-9-]*)['"]/g)].map((m) => m[1]);
}

export function computeGraph() {
  const seeds = new Set(SEED_FILES.map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f)));
  for (const dir of SEED_DIRS) for (const file of walk(path.join(ROOT, dir))) seeds.add(file);

  const callers = new Map();
  const record = (name) => {
    if (!callers.has(name)) callers.set(name, { ui: new Set(), fn: new Set(), declared: false });
    return callers.get(name);
  };

  const queue = [];
  for (const file of [...seeds].sort()) {
    for (const name of referencedFunctions(fs.readFileSync(file, "utf8"))) {
      if (!isFunction(name)) continue;
      record(name).ui.add(path.relative(ROOT, file));
      queue.push(name);
    }
  }
  for (const name of declaredPipelineFunctions()) {
    if (!isFunction(name)) continue;
    record(name).declared = "client.ts BUSY_FNS";
    queue.push(name);
  }
  for (const name of SERVER_SEEDS) {
    if (!isFunction(name)) throw new Error(`server ingress seed is missing: ${name}`);
    record(name).declared = record(name).declared || "server ingress";
    queue.push(name);
  }

  const seen = new Set();
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    for (const file of walk(path.join(FUNCTIONS, name))) {
      for (const target of referencedFunctions(fs.readFileSync(file, "utf8"))) {
        if (target === name || !isFunction(target)) continue;
        record(target).fn.add(name);
        if (!seen.has(target)) queue.push(target);
      }
    }
  }

  return [...callers.keys()].sort().map((name) => ({
    name,
    ui: [...callers.get(name).ui].sort(),
    fn: [...callers.get(name).fn].sort(),
    declared: callers.get(name).declared,
  }));
}

export function readAllowlist() {
  return fs
    .readFileSync(ALLOWLIST, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function main() {
  const graph = computeGraph();
  const reachable = graph.map((row) => row.name);

  if (process.argv.includes("--check")) {
    const allowed = readAllowlist();
    const missing = reachable.filter((n) => !allowed.includes(n));
    const extra = allowed.filter((n) => !reachable.includes(n));
    if (missing.length || extra.length) {
      if (missing.length) console.error(`reachable but not routed: ${missing.join(" ")}`);
      if (extra.length) console.error(`routed but no proven caller: ${extra.join(" ")}`);
      process.exit(1);
    }
    console.log(`ops/designpro-functions.txt matches the DesignPro graph (${allowed.length} functions)`);
    return;
  }

  const onDisk = fs
    .readdirSync(FUNCTIONS, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_")).length;
  console.log(`on disk ${onDisk} | reachable from the DesignPro chain ${reachable.length} | not routed ${onDisk - reachable.length}`);
  for (const row of graph) {
    const via = row.ui.length
      ? row.ui.map((p) => p.replace("app/src/", "")).join(" ")
      : row.declared
        ? row.declared
        : `called by ${row.fn.join(" ")}`;
    console.log(`${row.name.padEnd(33)} ${via}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
