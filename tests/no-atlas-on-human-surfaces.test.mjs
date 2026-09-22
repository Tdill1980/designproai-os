import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * NO HUMAN-READ SURFACE SAYS "ATLAS". Owner, 2026-09-21 and again 2026-09-22,
 * looking at the live board: "My 3-zone is Call 1. Delete ATLAS." / "Remove all
 * atlas references."
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
 *   - NOT "Powered by Atlas" -- mixed case, and the owner's own brand ruling
 *     of 2026-09-16 (`app/src/lib/os-brand.ts`). If that ruling changes,
 *     change the brand file, not this lock.
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

const PATTERNS = [
  { name: "A.T.L.A.S.", re: /A\.T\.L\.A\.S/ },
  { name: "ATLAS", re: /\bATLAS\b/ },
];

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

test("no customer or designer surface in app/src or gateway/src says ATLAS", () => {
  const offenders = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(path.join(root, dir))) {
      const rel = path.relative(root, file);
      if (SKIP_FILE(rel)) continue;
      const lines = stripComments(fs.readFileSync(file, "utf8")).split("\n");
      lines.forEach((line, index) => {
        for (const { name, re } of PATTERNS) {
          if (re.test(line)) offenders.push(`${rel}:${index + 1}  [${name}]  ${line.trim().slice(0, 120)}`);
        }
      });
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `These strings can reach a person and still say ATLAS. Rewrite the copy (print master / Call 1 / design), never the identifier:\n  ${offenders.join("\n  ")}`,
  );
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
