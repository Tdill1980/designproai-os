import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * NO HUMAN-READ SURFACE SAYS "ATLAS". Owner, 2026-09-21 and again 2026-09-22,
 * looking at the live board: "My 3-zone is Call 1. Delete ATLAS." / "Remove all
 * atlas references." Then, the same day: "Remove all UI Powered by Atlas" /
 * "Remove and hide atlas" -- the tagline this lock once exempted is retired,
 * and the internal word "topology" (the Call-1 route) joins the list.
 *
 * ATLAS is the internal name of the square canvas the cut panels are placed on
 * so downstream stages can read them. It is plumbing, and after #591 it is not
 * even what Call 1 paints. A customer or designer has no reason to know the
 * word exists, and every time it reached a screen it read as a broken or
 * half-finished product.
 *
 * #596 and #597 each removed the word from a handful of labels by hand and
 * each missed the next handful, because nothing looked for it. This does.
 *
 * SCOPE, deliberately:
 *   - app/src and gateway/src: every string that can render, toast, throw to a
 *     screen, or land in an aria/alt/title attribute.
 *   - NOT code comments (they are history, not product) -- stripped first.
 *   - NOT identifiers. `\bATLAS\b` is case-sensitive and word-bounded, so
 *     `atlasBinding`, `isAtlas`, `AtlasRefusal`, `ATLAS_UNCONFIRMED_...` and
 *     `FLAT_FIRST_ATLAS_PIPELINE_MODE` never match. Renaming those touches
 *     stored rows and the deployed edge function, which CLAUDE.md forbids.
 *   - "Powered by Atlas", ANY case, on every line: the 2026-09-16 brand ruling
 *     that exempted it was retired by the owner on 2026-09-22, and the tagline
 *     had also reached two SEO meta descriptions and the FAQ, which a crawler
 *     reads. Nothing replaces it; `ATLAS_BRAND` is deleted from os-brand.ts.
 *   - "topology" / "topologies", ANY case, but ONLY where a person can read
 *     it: inside a quoted string literal, or as JSX / HTML text. Identifiers
 *     (`authoringTopology`, `TOPOLOGY_LABEL`, `.topology`, `topology:` keys)
 *     stay legal, because renaming them touches stored rows and the gateway
 *     contract. `AtlasRefusedSheets` maps the route to product words instead.
 *   - app/index.html joins the scan: its meta description is read by every
 *     crawler and it is not under app/src.
 *   - NOT runtime/: model-facing prompt contracts name A.T.L.A.S. on purpose
 *     and are hash-pinned. The runtime error MESSAGES that reach a screen were
 *     rewritten by hand in the same change; the prompts were not.
 *   - NOT batch presets: "Atlas Cloud Solutions" is a fictional customer's
 *     company name in a brief, not the engine.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const SCAN_DIRS = ["app/src", "gateway/src"];
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const SKIP_FILE = (rel) =>
  /\.test\.[cm]?[jt]sx?$/.test(rel)
  || rel.startsWith("app/src/data/batch-presets");

const EXTRA_FILES = ["app/index.html"];

/** Whole-line patterns: an identifier can never legitimately spell these. */
const PATTERNS = [
  { name: "A.T.L.A.S.", re: /A\.T\.L\.A\.S/ },
  { name: "ATLAS", re: /\bATLAS\b/ },
  { name: "Powered by Atlas", re: /powered\s+by\s+atlas/i },
  // A STORED ENGINE STRING PRINTED AT RUNTIME. `promptVersion` values read
  // `designpro-flat-first-atlas-…` and `authoringTopology` reads `six-surface`
  // / `field`; neither is source text, so the word locks above never saw them,
  // and the PanelPro rail printed "V1 · designpro-flat-first-atlas-20260919…"
  // for three days (owner, 2026-09-22: "why is it showing an atlas — delete
  // this out of system"). A template interpolation or a JSX prop/child that
  // carries one of those fields is visible text and is convicted here.
  { name: "engine version string interpolated into visible text",
    re: /(?:\$\{|=\{|>\s*\{)[^}]*\b(?:promptVersion|prompt_version|authoringTopology)\b/ },
  // The same value dropped mid-sentence into JSX text ("…; prompt {x.promptVersion};
  // …"), where no `>` precedes the brace. A bare `{ identifier }` expression
  // after prose; a code block (`else {`, `=> {`) never reads this shape.
  { name: "engine version string interpolated into visible text",
    re: /(?:[;:.,]|\b[a-z]{2,})\s+\{\s*[\w.?!]*\b(?:promptVersion|prompt_version|authoringTopology)\b(?:\s*\|\|\s*"[^"]*")?\s*\}/ },
];

/** Visible-text-only pattern: convicted in string literals and JSX/HTML text, never in identifiers. */
const VISIBLE_WORD = { name: "topology (visible)", re: /\btopolog(?:y|ies)\b/i };
const JSX_LIKE = new Set([".tsx", ".jsx", ".html"]);

/**
 * The string literals on one comment-stripped line, with `${…}` holes cut out
 * of template literals so an interpolated identifier is not read as text.
 */
function stringLiterals(line) {
  const out = [];
  const re = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\\n]|\\.)*)`/g;
  let m;
  while ((m = re.exec(line))) {
    const before = line[m.index - 1];
    const after = line[m.index + m[0].length];
    // `Type["topology"]` is an indexed-access type / property reference and
    // `"topology": value` is an object key: both name an identifier, neither
    // is text a person reads. (A ternary writes `"a" : "b"` with a space.)
    if (before === "[" && after === "]") continue;
    if (after === ":") continue;
    const text = m[1] ?? m[2] ?? (m[3] ?? "").replace(/\$\{[^}]*\}/g, " ");
    out.push(text);
  }
  return out;
}

/**
 * What is left of a JSX/HTML line once string literals, `{…}` expressions and
 * tags are removed -- i.e. the text a browser would render -- provided the
 * residue does not look like code. A residue carrying `; = ( ) { } [ ]`, an
 * arrow, or a statement keyword is code, not prose, and is left alone.
 */
function jsxText(line) {
  let residue = line.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\\n]|\\.)*`/g, " ");
  for (let i = 0; i < 8; i += 1) {
    const next = residue.replace(/\{[^{}]*\}/g, " ").replace(/<[^<>]*>/g, " ");
    if (next === residue) break;
    residue = next;
  }
  if (/[;=(){}[\]]|=>/.test(residue)) return "";
  if (/^\s*(?:import|export|const|let|var|type|interface|function|return|case|default|if|else|for|while|switch|throw|new|async|await)\b/.test(residue)) return "";
  // A lone identifier, with or without a trailing comma, is a shorthand
  // property (`{ topology, attempt }` split across lines), not a sentence.
  if (/^\s*[A-Za-z_$][\w$]*\s*,?\s*$/.test(residue)) return "";
  return residue;
}

function visibleWordOffences(line, ext) {
  const texts = stringLiterals(line);
  if (JSX_LIKE.has(ext)) texts.push(jsxText(line));
  return texts.some((text) => VISIBLE_WORD.re.test(text));
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      walk(full, out);
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Remove block comments (which covers JSX `{/* ... *\/}`) and line comments.
 * A `//` preceded by `:` is a URL inside a string, not a comment. The strip
 * keeps line count so the reported line numbers are the file's own.
 */
function stripComments(source) {
  const noBlocks = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return noBlocks
    .split("\n")
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

function scanTargets() {
  const files = [];
  for (const dir of SCAN_DIRS) files.push(...walk(path.join(root, dir)));
  for (const extra of EXTRA_FILES) files.push(path.join(root, extra));
  return files;
}

function stripForFile(source, ext) {
  // HTML has its own comment syntax and no `//` lines.
  if (ext === ".html") return source.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
  return stripComments(source);
}

test("no customer or designer surface in app/src, gateway/src or app/index.html says ATLAS, Powered by Atlas, or topology", () => {
  const offenders = [];
  for (const file of scanTargets()) {
    const rel = path.relative(root, file);
    if (SKIP_FILE(rel)) continue;
    const ext = path.extname(file);
    const lines = stripForFile(fs.readFileSync(file, "utf8"), ext).split("\n");
    lines.forEach((line, index) => {
      for (const { name, re } of PATTERNS) {
        if (re.test(line)) offenders.push(`${rel}:${index + 1}  [${name}]  ${line.trim().slice(0, 120)}`);
      }
      if (visibleWordOffences(line, ext)) {
        offenders.push(`${rel}:${index + 1}  [${VISIBLE_WORD.name}]  ${line.trim().slice(0, 120)}`);
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `These strings can reach a person and still name the engine or its route. Rewrite the copy (print master / Call 1 / design / Production Panel Proof), never the identifier:\n  ${offenders.join("\n  ")}`,
  );
});

test("no file a customer or designer downloads is named after the engine, and the ZIP carries the product's own name", () => {
  // Owner, 2026-09-22: "fix remove atlas come up with a proprietary name for
  // our ProductionPanelProof." The text lock above never looked at a
  // `download=` attribute or at the file names the runtime writes into the
  // production ZIP, which is how `proofs/atlas-master.png` reached customers
  // while every screen was clean. Both are scanned here. Storage paths and
  // artifact `kind` values are identifiers and are not in scope.
  const offenders = [];
  for (const file of scanTargets()) {
    const rel = path.relative(root, file);
    if (SKIP_FILE(rel)) continue;
    stripComments(fs.readFileSync(file, "utf8")).split("\n").forEach((line, index) => {
      const m = line.match(/\bdownload=\{?\s*([`"'])((?:(?!\1)[^\n])*)\1/);
      // `${…}` holes carry identifiers (`${atlas.revisionSequence}`), not text a
      // person reads -- the same cut the string-literal scanner makes above.
      if (m && /atlas/i.test(m[2].replace(/\$\{[^}]*\}/g, " "))) offenders.push(`${rel}:${index + 1}  [download name]  ${line.trim().slice(0, 120)}`);
    });
  }
  for (const rel of ["runtime/designpro-standalone-claimant.cjs", "runtime/zip-spool.cjs", "runtime/wrapbox-delivery.cjs"]) {
    stripComments(fs.readFileSync(path.join(root, rel), "utf8")).split("\n").forEach((line, index) => {
      const m = line.match(/archivePath\s*[:=]\s*([`"'])([^`"'\n]*)\1/);
      if (m && /atlas/i.test(m[2])) offenders.push(`${rel}:${index + 1}  [archive path]  ${line.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(offenders, [], `A file name a person downloads still names the engine:\n  ${offenders.join("\n  ")}`);

  // The runtime cannot import os-brand.ts, so the ZIP's file stem is mirrored
  // there by hand. This is what keeps the two from drifting.
  const brand = fs.readFileSync(path.join(root, "app/src/lib/os-brand.ts"), "utf8");
  const stem = brand.match(/fileStem:\s*"([a-z0-9-]+)"/)?.[1];
  assert.ok(stem, "PROOF_BRAND.fileStem is declared");
  const claimant = fs.readFileSync(path.join(root, "runtime/designpro-standalone-claimant.cjs"), "utf8");
  assert.ok(claimant.includes(`archivePath: "proofs/${stem}.png"`), `the ZIP names the sheet proofs/${stem}.png, as os-brand.ts spells it`);
  assert.ok(!claimant.includes('archivePath: "proofs/print-master.png"'),
    "the retired assembled sheet is not packaged at all (owner, 2026-09-22)");
});

test("the visible-word check convicts prose and spares identifiers", () => {
  // Identifiers and object keys: legal, because renaming them touches stored rows.
  for (const line of [
    "const label = TOPOLOGY_LABEL[refusal.topology];",
    "  topology: \"six-surface\" | \"field\" | \"hero-driver\";",
    "const x = provenance?.topology || null;",
    "  const topology = String(row?.topology || \"\");",
    "metadata.authoringTopology === PANEL_PROOF_TOPOLOGY",
    "        topology,",
    'const TOPOLOGY_LABEL: Record<AtlasRefusal["topology"], string> = {',
    '  "panel-proof": "Production panel proof",',
  ]) {
    assert.equal(visibleWordOffences(line, ".tsx"), false, line);
    assert.equal(visibleWordOffences(line, ".mjs"), false, line);
  }
  // Text a person reads: convicted, in a literal, in JSX text, in an attribute.
  for (const line of [
    '<Fact label="Topology" value={provenance?.topology || null} />',
    "  {brand.poweredBy} — One prepared vehicle topology, one master, six labeled panels.",
    "throw new Error(`the ${kind} topology is not supported`);",
    '<meta name="description" content="Six topologies, one OS.">',
  ]) {
    assert.equal(visibleWordOffences(line, ".tsx"), true, line);
  }
  // In a non-JSX module only literals count, so bare prose there is impossible anyway.
  assert.equal(visibleWordOffences('const msg = "field topology refused";', ".mjs"), true);
  assert.equal(visibleWordOffences("const topology = pick();", ".mjs"), false);
  // The tagline is convicted whatever its case.
  assert.match("VehiclePro. WallPro. CutPro. Powered by Atlas.", PATTERNS[2].re);
  assert.match("…and CutPro, powered by Atlas.", PATTERNS[2].re);
});

test("the comment stripper does not blind the lock", () => {
  // A real string beside a comment must still be seen, and a URL must not be
  // mistaken for a comment that hides the rest of the line.
  const sample = [
    'const a = "A.T.L.A.S. master"; // A.T.L.A.S. in a comment',
    '/* ATLAS */ const b = "ATLAS run";',
    'const c = "https://example.test/x ATLAS";',
    '{/* ATLAS */}',
  ].join("\n");
  const kept = stripComments(sample).split("\n");
  assert.match(kept[0], /A\.T\.L\.A\.S\. master/);
  assert.doesNotMatch(kept[0], /in a comment/);
  assert.match(kept[1], /"ATLAS run"/);
  assert.doesNotMatch(kept[1], /\/\* ATLAS \*\//);
  assert.match(kept[2], /x ATLAS/);
  assert.doesNotMatch(kept[3], /ATLAS/);
});
