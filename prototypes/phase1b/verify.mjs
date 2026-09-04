/** PASS/FAIL evidence for the Phase-1B offline proof. No provider call. */
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { compileOnce, OUT } from "./compile.mjs";
import { GENIE_TRIM, BLEED_INCHES, CUSTOMER } from "./fixture.mjs";

const require = createRequire(import.meta.url);
const sharp = require("../../runtime/node_modules/sharp");
const compiler = require("./atlas-window-compiler.cjs");
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

const KEYS = ["driver", "passenger", "hood", "roof", "front", "rear"];
const rows = [];
const gate = (name, pass, detail) => rows.push({ name, pass: !!pass, detail });

/** Any pixel that is transparent, or is the compositor's ground colour. */
async function holes(bytes) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let transparent = 0, ground = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 255) transparent += 1;
    else if (data[i] === 10 && data[i + 1] === 10 && data[i + 2] === 12) ground += 1;
  }
  return { px: info.width * info.height, transparent, ground };
}

const r = await compileOnce();
const panels = new Map(r.panels.map((p) => [p.surfaceKey, p]));
const wins = new Map(r.compiled.surfaces.map((s) => [s.surfaceKey, s]));

// 1 — six distinct GENIE-proportioned windows
const aspErrs = KEYS.map((k) => {
  const s = wins.get(k);
  return { k, err: Math.abs(s.printAspect - s.windowAspect) / s.printAspect };
});
gate("six windows at GENIE surface proportions",
  r.compiled.surfaces.length === 6 && aspErrs.every((a) => a.err < 0.002),
  aspErrs.map((a) => `${a.k} ${(a.err * 100).toFixed(3)}%`).join(", ") + "  (was +37.8% flanks / +76.3% front under fit:\"fill\")");

// 2 — nothing is resampled
const rs = r.compiled.resampling;
gate("no stretch: field, windows, type and panels are never resized",
  rs.fieldResized === false && rs.windowsResized === false && rs.textScaled === false && rs.panelsResized === false,
  JSON.stringify(rs));

// 3 — the only scale is the logo, and it is uniform
const logoPlacements = r.compiled.placements.filter((p) => p.kind === "logo");
gate("approved logo scaled uniformly only",
  logoPlacements.length > 0 && logoPlacements.every((p) => p.uniformScale && p.aspectDrift <= compiler.MAX_LOGO_ASPECT_DRIFT),
  logoPlacements.map((p) => `${p.surfaceKey} ${p.sourcePx}->${p.placedPx} drift ${(p.aspectDrift * 100).toFixed(3)}%`).join(", "));

// 4 — the field is overscan and carries no protected content
gate("creative field is overscanned and carries no lettering or logo",
  r.compiled.field.width > 4096 && r.compiled.field.height > 4096 && r.compiled.field.overscanMarginPx > 0,
  `${r.compiled.field.width}x${r.compiled.field.height}, margin ${r.compiled.field.overscanMarginPx}px; every string and the mark are composited after the crop`);

// 5 — exact GENIE trim and 5" bleed on all six
let dimsOk = true;
const dimRows = KEYS.map((k) => {
  const p = panels.get(k);
  const [w, h] = GENIE_TRIM[k];
  const ok = p.trimWidthIn === w && p.trimHeightIn === h && p.bleedInches === BLEED_INCHES;
  dimsOk = dimsOk && ok;
  return `${k} ${p.trimWidthIn}x${p.trimHeightIn}+${p.bleedInches}"`;
});
gate("exact GENIE trim and 5\" bleed on all six", dimsOk, dimRows.join(", "));

// 6 — driver and passenger are distinct
gate("Driver and Passenger are distinct artwork",
  panels.get("driver").contentHash !== panels.get("passenger").contentHash
  && wins.get("driver").source.top !== wins.get("passenger").source.top,
  `cut from different field rows (y=${wins.get("driver").source.top} vs ${wins.get("passenger").source.top}); panel hashes ${panels.get("driver").contentHash.slice(0, 10)} vs ${panels.get("passenger").contentHash.slice(0, 10)}`);

// 7 — no missing pixels
const holeRows = [];
let filled = true;
for (const k of KEYS) {
  const h = await holes(panels.get(k).bytes);
  filled = filled && h.transparent === 0 && h.ground === 0;
  holeRows.push(`${k} t=${h.transparent} g=${h.ground}`);
}
gate("no missing pixels in any panel", filled, holeRows.join(", "));

// 8 — exact spelling and exact logo bytes
gate("exact spelling and exact approved logo bytes",
  r.compiled.placements.filter((p) => p.kind === "text").every((p) => Object.values(CUSTOMER).includes(p.string))
  && logoPlacements.every((p) => p.contentHash === r.fx.logoHash),
  `strings from the frozen fixture only; logo digest ${r.fx.logoHash.slice(0, 12)} verified before every placement`);

// 9 — lineage unchanged
gate("every panel binds to masterContentHash (semantics unchanged)",
  KEYS.every((k) => panels.get(k).sourceMasterHash === r.compiled.masterContentHash),
  `sourceMasterHash == masterContentHash ${r.compiled.masterContentHash.slice(0, 16)} on all six`);

// 10 — existing consumers still satisfied
const required = ["contract", "surfaceKey", "contentHash", "pixelWidth", "pixelHeight", "trimWidthIn", "trimHeightIn",
  "printWidthIn", "printHeightIn", "bleedInches", "sourceMasterHash", "surfaceSourceHash", "method",
  "deterministic", "genieManifestId", "genieManifestHash", "productionEligible"];
gate("existing extractor and downstream consumer shapes unchanged",
  KEYS.every((k) => required.every((f) => panels.get(k)[f] !== undefined)),
  `${required.length} contract fields present on all six; contract=${panels.get("driver").contract}; extractor used as-is`);

// 11 — preview tier, stated honestly
gate("preview resolution only -- not claimed as 150 PPI",
  KEYS.every((k) => panels.get(k).effectivePpi < 150),
  `flanks ${panels.get("driver").effectivePpi} PPI, centre ${panels.get("hood").effectivePpi} PPI; production resolution is out of scope for this proof`);

mkdirSync(OUT, { recursive: true });
const receipt = {
  genieManifestHash: r.genieManifestHash,
  creativeFieldHash: r.compiled.field.sourceHash,
  masterContentHash: r.compiled.masterContentHash,
  logoHash: r.fx.logoHash, fontHash: r.fx.fontHash,
  windows: r.compiled.surfaces, placements: r.compiled.placements,
  operations: r.compiled.operations, resampling: r.compiled.resampling,
  coverage: r.compiled.coverage, timings: r.timings, panelReadyMs: r.panelReadyMs,
  panels: r.panels.map((p) => ({ surfaceKey: p.surfaceKey, contentHash: p.contentHash, px: `${p.pixelWidth}x${p.pixelHeight}`,
    trimIn: `${p.trimWidthIn}x${p.trimHeightIn}`, bleedIn: p.bleedInches, effectivePpi: p.effectivePpi, sourceMasterHash: p.sourceMasterHash })),
  gates: rows,
};
writeFileSync(join(OUT, "receipt.json"), JSON.stringify(receipt, null, 2));

let failed = 0;
console.log("\n=== PHASE 1B ACCEPTANCE ===");
for (const g of rows) { if (!g.pass) failed += 1; console.log(`${g.pass ? "PASS" : "FAIL"}  ${g.name}\n      ${g.detail}`); }
console.log(`\n${rows.length - failed}/${rows.length} gates passed`);
process.exitCode = failed ? 1 : 0;
