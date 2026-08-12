import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const ROOT = "/workspace/restylepro-os";
const SRC = join(ROOT, "src");
const APPS = {
  "DesignPro (generation)": "src/pages/DesignPro.tsx",
  "RecreatePro": "src/components/graphicspro-v1/GraphicsProV1ToolUI.tsx",
  "GraphicsPro": "src/pages/GraphicsPro.tsx",
  "WallPro": "src/pages/WallPro.tsx",
  "MyVehiclePro": "src/pages/MyVehiclePro.tsx",
  "Gallery": "src/pages/Gallery.tsx",
  "RevisionStudio": "src/pages/RevisionStudioIQ.tsx",
  "PanelProStudio": "src/pages/DesignPanelProWorkspace.tsx",
  "ApprovePro": "src/pages/ApproveProPage.tsx",
  "ProductionFlow": "src/pages/ProductionFlow.tsx",
  "WrapBox": "src/pages/WrapBox.tsx",
};
const exts = [".tsx", ".ts", ".jsx", ".js"];

function resolveImport(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const e of exts) if (existsSync(base + e)) return base + e;
  for (const e of exts) if (existsSync(join(base, "index" + e))) return join(base, "index" + e);
  return existsSync(base) && !base.match(/\.\w+$/) ? null : (existsSync(base) ? base : null);
}

function closure(entry) {
  const seen = new Set();
  const stack = [join(ROOT, entry)];
  while (stack.length) {
    const file = stack.pop();
    if (!file || seen.has(file) || !existsSync(file)) continue;
    if (!exts.some((e) => file.endsWith(e))) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/g)) {
      const next = resolveImport(m[1], file);
      if (next) stack.push(next);
    }
    for (const m of text.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const next = resolveImport(m[1], file);
      if (next) stack.push(next);
    }
  }
  return [...seen];
}

function scan(files) {
  const tables = new Set(), fns = new Set(), buckets = new Set(), pkgs = new Set();
  let lines = 0;
  for (const f of files) {
    const t = readFileSync(f, "utf8");
    lines += t.split("\n").length;
    for (const m of t.matchAll(/\.from\(\s*['"]([a-z0-9_]+)['"]/gi)) tables.add(m[1]);
    for (const m of t.matchAll(/functions\.invoke\(\s*['"]([^'"]+)['"]/g)) fns.add(m[1]);
    for (const m of t.matchAll(/storage\s*\.from\(\s*['"]([^'"]+)['"]/g)) buckets.add(m[1]);
    for (const m of t.matchAll(/from\s*['"]([a-z@][^'".][^'"]*)['"]/g)) {
      if (!m[1].startsWith(".") && !m[1].startsWith("@/")) pkgs.add(m[1].split("/").slice(0, m[1].startsWith("@") ? 2 : 1).join("/"));
    }
  }
  // storage buckets get picked up by the generic .from() too; separate them out
  for (const b of buckets) tables.delete(b);
  return { lines, tables: [...tables].sort(), fns: [...fns].sort(), buckets: [...buckets].sort(), pkgs: [...pkgs].sort() };
}

const report = {};
for (const [app, entry] of Object.entries(APPS)) {
  if (!existsSync(join(ROOT, entry))) { report[app] = { error: "entrypoint not found", entry }; continue; }
  const files = closure(entry);
  report[app] = { entry, fileCount: files.length, ...scan(files) };
}
writeFileSync("/tmp/claude-0/-home-user-designproai-os/eed283f8-4a26-56ef-8874-f4f04e7894ad/scratchpad/inventory.json", JSON.stringify(report, null, 2));

console.log("APP".padEnd(24), "FILES".padStart(6), "LINES".padStart(8), "TABLES".padStart(7), "EDGE FN".padStart(8), "BUCKETS".padStart(8));
for (const [app, r] of Object.entries(report)) {
  if (r.error) { console.log(app.padEnd(24), "  --  ", r.error); continue; }
  console.log(app.padEnd(24), String(r.fileCount).padStart(6), String(r.lines).padStart(8), String(r.tables.length).padStart(7), String(r.fns.length).padStart(8), String(r.buckets.length).padStart(8));
}
const allFns = new Set(), allTables = new Set(), allBuckets = new Set();
for (const r of Object.values(report)) { (r.fns||[]).forEach(x=>allFns.add(x)); (r.tables||[]).forEach(x=>allTables.add(x)); (r.buckets||[]).forEach(x=>allBuckets.add(x)); }
console.log(`\nUNION: ${allTables.size} tables, ${allFns.size} edge functions, ${allBuckets.size} storage buckets`);
console.log(`\nEDGE FUNCTIONS (${allFns.size}):`); console.log([...allFns].sort().join(", "));
console.log(`\nSTORAGE BUCKETS (${allBuckets.size}):`); console.log([...allBuckets].sort().join(", "));
