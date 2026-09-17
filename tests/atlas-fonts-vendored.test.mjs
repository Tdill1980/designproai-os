// ARCHITECTURE_DAG.md chunk 1 — the element graph's typography is DETERMINISTIC,
// which starts with the fonts.
//
// The RestylePro reference (`api/typeset-layer.js`, RULE 1) fetches its TTFs from
// raw.githubusercontent.com AT REQUEST TIME. That is fine for a Vercel handler a
// human pokes; it is not fine for a graph node with a lease, a retry budget and
// an idempotency contract — a node that can fail on a third-party fetch is not
// deterministic, and two runs of the same brief could render from different bytes.
//
// So the faces are VENDORED and hash-pinned, and this test is the pin.
//
// It also proves the reference's own registry had already rotted: three of its
// twenty paths 404 on google/fonts@main today because the families moved from
// ofl/ to apache/ (marker, satisfy, yellowtail). A build that fetched at runtime
// would have lost those three silently to the DEFAULT_NAME_FONT fallback.
//
// What is locked:
//   1. every manifest entry has its file, and the bytes hash to the pinned sha256;
//   2. opentype.js parses each one and getPath() yields real <path> OUTLINES —
//      which is the whole reason this pipeline does not use SVG <text> (serverless
//      sharp/librsvg ships no system fonts and renders <text> as tofu boxes);
//   3. every face ships its licence text beside it (OFL-1.1 / Apache-2.0);
//   4. the two defaults the producer falls back to actually exist.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const FONT_DIR = join(HERE, "..", "runtime", "atlas-fonts");
const manifest = JSON.parse(readFileSync(join(FONT_DIR, "fonts.json"), "utf8"));

// opentype.js lives in the RUNTIME's node_modules, because the node that uses it
// runs in the runtime image — not in the app and not at the repo root.
const runtimeRequire = createRequire(join(HERE, "..", "runtime", "package.json"));

test("the vendored font manifest is the contract", () => {
  assert.equal(manifest.contract, "designpro.atlas-fonts.v1");
  assert.equal(Object.keys(manifest.fonts).length, 20, "the reference registry is twenty faces");
  assert.ok(manifest.fonts[manifest.defaultNameFont], "default name font must be vendored");
  assert.ok(manifest.fonts[manifest.defaultContactFont], "default contact font must be vendored");
});

test("every vendored face hashes to its pin, parses, and outlines", () => {
  const opentype = runtimeRequire("opentype.js");
  for (const [key, entry] of Object.entries(manifest.fonts)) {
    const file = join(FONT_DIR, entry.file);
    assert.ok(existsSync(file), `${key}: ${entry.file} is missing`);

    const bytes = readFileSync(file);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      entry.sha256,
      `${key}: vendored bytes do not match the pinned sha256`,
    );
    assert.equal(bytes.length, entry.bytes, `${key}: byte length drifted`);

    const font = opentype.parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
    );
    assert.ok(font.unitsPerEm > 0, `${key}: no unitsPerEm`);

    // The outline path is the deliverable. <text> would be tofu.
    const svg = font.getPath("Precision Climate Solutions", 0, 100, 120).toSVG(2);
    assert.match(svg, /<path/, `${key}: getPath produced no <path>`);
    assert.ok(svg.length > 200, `${key}: outline is suspiciously short (${svg.length})`);

    // Advance width is what centres the lockup; zero would stack every glyph.
    assert.ok(font.getAdvanceWidth("Precision", 120) > 0, `${key}: zero advance width`);
  }
});

test("every vendored face ships its licence", () => {
  for (const [key, entry] of Object.entries(manifest.fonts)) {
    assert.ok(entry.license, `${key}: no licence recorded`);
    assert.ok(
      existsSync(join(FONT_DIR, entry.license)),
      `${key}: licence file ${entry.license} is missing — OFL and Apache both require it to ship with the font`,
    );
    assert.ok(
      ["OFL-1.1", "Apache-2.0"].includes(entry.licenseType),
      `${key}: unexpected licence type ${entry.licenseType}`,
    );
  }
});

test("the manifest records where each face came from, so the pin can be re-derived", () => {
  for (const [key, entry] of Object.entries(manifest.fonts)) {
    assert.match(
      entry.upstream,
      /^https:\/\/raw\.githubusercontent\.com\/google\/fonts\/main\/(ofl|apache)\//,
      `${key}: upstream must name the exact google/fonts path`,
    );
  }
});
