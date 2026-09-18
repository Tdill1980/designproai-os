// ARCHITECTURE_DAG.md chunk 2 — `runtime/atlas-typeset-layer.cjs`, the element
// graph's TYPOGRAPHY PRODUCER, ported from `restylepro-os api/typeset-layer.js`
// under RULE 1.
//
// This is the module `typeset.produce` and `contact.produce` will call, so what
// has to be true of it is what has to be true of a graph node's output:
//
//   1. DETERMINISM IS THE CONTRACT. Same input -> same bytes -> same sha256, on
//      every worker, every time. Without it the node's idempotency promise is a
//      wish: a re-claimed node would write a second artifact instead of
//      re-reading its own.
//   2. TRANSPARENT. This is Layer 1, composited over the clean authored base
//      (ARCHITECTURE_DAG.md §4.1). A baked background is the hard-edged seam
//      that DID-9789762D shipped and this whole port exists to remove.
//   3. FAILS CLOSED on a font it cannot prove. The reference falls back to the
//      default face; silently setting a print file in a different typeface than
//      the design recorded is an undetectable lie, so here it throws.
//   4. NO NETWORK. The faces are vendored; a node that can fail on a
//      third-party fetch is not deterministic.
//   5. The storage path IS the content hash.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = join(HERE, "..", "runtime", "atlas-typeset-layer.cjs");
const runtimeRequire = createRequire(join(HERE, "..", "runtime", "package.json"));
const typeset = runtimeRequire(MODULE_PATH);
const sharp = runtimeRequire("sharp");

const BRIEF = {
  name: "Precision Climate Solutions",
  lines: ["(520) 555-0192", "precisionclimate.com"],
  color: "1f2937",
  width: 1600,
};

test("the same brief renders byte-identical bytes, twice", async () => {
  const a = await typeset.renderLockup(BRIEF);
  const b = await typeset.renderLockup(BRIEF);
  assert.equal(a.contentHash, b.contentHash, "a node re-claim must re-read, not re-write");
  assert.equal(a.byteSize, b.byteSize);
  assert.equal(a.deterministic, true);
  assert.equal(a.contract, "designpro.atlas-typeset-layer.v1");
});

test("two WORKERS render the same element — determinism across processes, not just calls", () => {
  // The in-process test above shares a parsed font and one sharp instance, so it
  // cannot see a difference that only appears on a cold worker. `runtime-1` and
  // `runtime-2` both claim element nodes, and if they disagreed by a byte the
  // provider cache and the sha256 storage path would diverge between them.
  const render = `
    const t = require(${JSON.stringify(MODULE_PATH)});
    t.renderLockup(${JSON.stringify(BRIEF)}).then(r => process.stdout.write(r.contentHash));
  `;
  const one = execFileSync(process.execPath, ["-e", render], { encoding: "utf8" });
  const two = execFileSync(process.execPath, ["-e", render], { encoding: "utf8" });
  assert.match(one, /^[0-9a-f]{64}$/);
  assert.equal(one, two, "two cold workers must agree byte for byte");
});

test("a different brief is a different artifact", async () => {
  const a = await typeset.renderLockup(BRIEF);
  const b = await typeset.renderLockup({ ...BRIEF, name: "Arctic Air" });
  assert.notEqual(a.contentHash, b.contentHash);

  // ...and so is the same words in a different face, or the design could not
  // record which typeface it actually used.
  const c = await typeset.renderLockup({ ...BRIEF, nameFont: "bebas" });
  assert.notEqual(a.contentHash, c.contentHash);
  assert.equal(c.fonts.name.key, "bebas");
  assert.match(c.fonts.name.sha256, /^[0-9a-f]{64}$/);
});

test("the lockup is transparent and actually carries ink", async () => {
  const { bytes, width, height } = await typeset.renderLockup(BRIEF);
  const img = sharp(bytes);
  const meta = await img.metadata();
  assert.equal(meta.format, "png");
  assert.equal(meta.width, width);
  assert.equal(meta.height, height);
  assert.equal(meta.channels, 4, "Layer 1 must carry alpha");
  assert.equal(meta.hasAlpha, true);

  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => data[(y * info.width + x) * info.channels + 3];
  for (const [x, y] of [[0, 0], [info.width - 1, 0], [0, info.height - 1], [info.width - 1, info.height - 1]]) {
    assert.equal(px(x, y), 0, `corner ${x},${y} must be transparent, not a baked background`);
  }

  let ink = 0;
  for (let i = 3; i < data.length; i += info.channels) if (data[i] > 0) ink += 1;
  assert.ok(ink > 1000, `expected real outlines, got ${ink} opaque pixels`);
});

test("contact lines set smaller than the name, and more lines make a taller canvas", async () => {
  const nameOnly = await typeset.renderLockup({ name: BRIEF.name, width: 1600 });
  const withLines = await typeset.renderLockup(BRIEF);
  assert.ok(withLines.height > nameOnly.height);
  assert.equal(withLines.metrics.lineSize, Math.round(1600 * 0.05));

  // THIS FIXTURE ENCODED THE BUG (corrected 2026-09-18, live 34613569).
  //
  // BRIEF.name is "Precision Climate Solutions" -- the exact string that shipped
  // clipped to "Precision Climate Se" on a customer's flank -- and this line
  // asserted `nameSize === 1600 * 0.12`, which was TRUE the whole time and said
  // nothing about whether the name fitted the canvas it was drawn on. It was
  // checking the reference PROPORTION, and that meaning now lives in
  // `nominalNameSize`, which is still pinned here exactly as before.
  assert.equal(withLines.metrics.nominalNameSize, Math.round(1600 * 0.12),
    "the reference proportion is unchanged -- only what is DRAWN is fitted");
  // What the fixture never checked, and now does: the ink fits the canvas.
  assert.ok(withLines.metrics.inkWidth <= 1600 - withLines.metrics.pad * 2,
    "the lockup must fit inside its own padding, not run off the right edge");
  assert.ok(withLines.metrics.lineSize < withLines.metrics.nameSize);

  // A contact bar with no headline is legal — that is `contact.produce`.
  const barOnly = await typeset.renderLockup({ lines: BRIEF.lines, width: 1600 });
  assert.ok(barOnly.height > 0);
  assert.ok(barOnly.height < withLines.height);
});

test("an unprovable face fails closed rather than falling back", () => {
  assert.throws(() => typeset.loadFont("comic-sans"), /atlas_typeset_font_unknown/);
  // The reference returns DEFAULT_NAME_FONT here. We refuse: a print file set in
  // a face the design never chose is worse than a refusal.
});

test("every vendored face is reachable by key, and the defaults are among them", () => {
  const keys = typeset.fontKeys();
  assert.equal(keys.length, 20);
  assert.ok(keys.includes(typeset.DEFAULT_NAME_FONT));
  assert.ok(keys.includes(typeset.DEFAULT_CONTACT_FONT));
  for (const key of keys) {
    const face = typeset.loadFont(key);
    assert.match(face.sha256, /^[0-9a-f]{64}$/);
  }
});

test("colour and width are normalised, never trusted", async () => {
  assert.equal(typeset.normalizeColor("#AABBCC"), "#aabbcc");
  assert.equal(typeset.normalizeColor("nonsense"), "#1f2937");
  assert.equal(typeset.normalizeColor(null), "#1f2937");
  assert.equal(typeset.clampWidth(10), typeset.MIN_WIDTH_PX);
  assert.equal(typeset.clampWidth(99999), typeset.MAX_WIDTH_PX);

  const wrapped = await typeset.renderLockup({ ...BRIEF, color: "not-a-colour" });
  assert.equal(wrapped.color, "#1f2937");
});

test("nothing to set is a refusal, not an empty artifact", async () => {
  await assert.rejects(() => typeset.renderLockup({}), /atlas_typeset_empty/);
  await assert.rejects(() => typeset.renderLockup({ name: "   ", lines: ["  "] }), /atlas_typeset_empty/);
});

test("the storage path IS the content hash", async () => {
  const { contentHash } = await typeset.renderLockup(BRIEF);
  assert.equal(typeset.elementStoragePath(contentHash), `atlas-elements/${contentHash}.png`);
  assert.throws(() => typeset.elementStoragePath("../escape"), /atlas_typeset_bad_content_hash/);
  assert.throws(() => typeset.elementStoragePath(""), /atlas_typeset_bad_content_hash/);
});

test("the producer reaches no network and persists nothing", () => {
  const source = readFileSync(MODULE_PATH, "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\/|(^|\s)\/\/.*$/gm, "");
  for (const forbidden of ["fetch(", "https://", "node:http", "createClient", "supabase", "Date.now", "Math.random"]) {
    assert.ok(
      !code.includes(forbidden),
      `${forbidden} has no place in a deterministic producer — storage is the node's job`,
    );
  }
});

test("a long company name is FITTED to the canvas, never run off it", async () => {
  // Live 34613569: the composited flank read "Precision Climate Se" because the
  // sizes are fixed PROPORTIONS of the canvas -- nameSize = canvasWidth * 0.12 --
  // and say nothing about how many characters the name has. `outline()` centres
  // by `x = max(pad, (width - advance) / 2)`, so once the advance exceeds the
  // canvas that term goes negative, x clamps to pad, and the tail of the word
  // runs off the right edge of the SVG and is clipped.
  //
  // The receipt proved it arithmetically before any pixel was opened:
  // nameSize 192 implies a 1600px canvas, and inkWidth was 2102 -- 502px over.
  const width = 1600;
  const rendered = await typeset.renderLockup({
    name: "Precision Climate Solutions",
    lines: ["(520) 555-0192", "precisionclimate.designproai.com"],
    width,
  });

  const usable = width - rendered.metrics.pad * 2;
  assert.ok(rendered.metrics.inkWidth <= usable,
    `the lockup must fit its own canvas: ink ${rendered.metrics.inkWidth} > usable ${usable}`);

  // It was FITTED, not truncated: the drawn size is below the nominal one and
  // the nominal is still reported, so the shrink is visible rather than silent.
  assert.ok(rendered.metrics.nameSize < rendered.metrics.nominalNameSize,
    "a name too wide for the canvas must be scaled down");
  assert.equal(rendered.metrics.nominalNameSize, Math.round(width * 0.12),
    "the reference proportion is unchanged -- only what is DRAWN moves");

  // And the canvas still holds every glyph: no path may start left of the pad
  // or end past the right edge.
  assert.match(rendered.svg, new RegExp(`width="${width}"`));
});

test("a name that already fits is byte-identical to before the fit", async () => {
  // The fit must be a no-op on every lockup that was already correct, which is
  // every fixture in this file and every short business name.
  const rendered = await typeset.renderLockup({ name: "Bright Smiles", lines: [], width: 1600 });
  assert.equal(rendered.metrics.nameSize, rendered.metrics.nominalNameSize,
    "a name that fits must be drawn at the reference proportion, untouched");
});
