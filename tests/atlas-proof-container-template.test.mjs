/**
 * The container template has TWO HOMES, AND THEY ARE LOCKED BY EXECUTION.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner ruling, Trish 2026-09-18: "just use template wired as a studio edge
 * function." So the drawing now exists in the edge
 * (`supabase/functions/_shared/atlas-proof-container-template.ts`) as well as
 * on the runtime (`runtime/atlas-proof-container-template.cjs`), because sharp
 * cannot run in Deno and resvg-wasm can — the RASTERISER differs, the drawing
 * must not.
 *
 * A STRING DIFF WOULD BE THE WRONG LOCK. The two files cannot be byte-identical
 * (one is TypeScript with type annotations, the other is CommonJS), so a diff
 * either fails permanently or has to be loosened until it proves nothing. What
 * matters is not that the SOURCE matches — it is that the OUTPUT does, because
 * the output is the sheet a model is taught from.
 *
 * So this transpiles the TS with esbuild and RUNS both builders over the same
 * manifests, asserting the SVG comes back byte-identical. That is the precedent
 * `tests/designpro-persona-contract.test.mjs` sets: transpile and execute the
 * deployed assembly rather than re-describing it.
 *
 * AND IT VARIES THE MANIFEST, NOT ONLY THE STRINGS. A per-vehicle renderer that
 * was accidentally hard-wired to one vehicle would still pass a single-fixture
 * lock — that exact defect shipped once already, and the lock written for it
 * passed against a renderer pinned to the Prius because it varied the vehicle
 * NAME (which prints in the header) as well as the geometry. Here the company
 * and vehicle strings are HELD CONSTANT and only the inches move, so the only
 * thing that can make the two sheets differ is the geometry itself.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveEsbuild } from "../scripts/build-control-prompt.mjs";
import * as runtimeTemplate from "../runtime/atlas-proof-container-template.cjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(REPO, "supabase/functions/_shared/atlas-proof-container-template.ts");

let edgeModule = null;
async function edge() {
  if (!edgeModule) {
    const outDir = mkdtempSync(join(tmpdir(), "atlas-container-"));
    const bundle = join(outDir, "container.mjs");
    execFileSync(resolveEsbuild(), [
      SOURCE, "--bundle", "--format=esm", "--platform=neutral", `--outfile=${bundle}`,
    ], { stdio: "pipe" });
    edgeModule = await import(`file://${bundle}`);
  }
  return edgeModule;
}

/** Two real vehicles with genuinely different proportions. */
const PRIUS = [
  "DRIVER: 165.7\" wide x 49.6\" high",
  "PASSENGER: 165.7\" wide x 49.6\" high",
  "ROOF: 110.2\" wide x 55.1\" high",
  "HOOD: 55.9\" wide x 48.0\" high",
  "FRONT: 50.0\" wide x 22.0\" high",
  "REAR: 55.1\" wide x 30.7\" high",
];
const F250 = [
  "DRIVER: 251.0\" wide x 60.0\" high",
  "PASSENGER: 251.0\" wide x 60.0\" high",
  "ROOF: 82.0\" wide x 68.0\" high",
  "HOOD: 66.0\" wide x 62.0\" high",
  "FRONT: 80.0\" wide x 34.0\" high",
  "REAR: 78.0\" wide x 44.0\" high",
];

// HELD CONSTANT ACROSS BOTH VEHICLES, deliberately — see the header.
const BRAND = { companyName: "BRIGHT SMILES DENTAL", vehicle: "2012 TOYOTA PRIUS" };

test("both homes parse the contract's own panel rows into the same six surfaces", async () => {
  const { parsePanelRows } = await edge();
  for (const rows of [PRIUS, F250]) {
    assert.deepEqual(parsePanelRows(rows), runtimeTemplate.parsePanelRows(rows));
    assert.equal(parsePanelRows(rows).zones.length, 6);
  }
});

test("both homes draw a byte-identical sheet, on two different vehicles", async () => {
  const edgeMod = await edge();
  for (const rows of [PRIUS, F250]) {
    const options = { manifest: runtimeTemplate.parsePanelRows(rows), ...BRAND };
    const fromEdge = edgeMod.containerSvg(options);
    const fromRuntime = runtimeTemplate.containerSvg(options);
    assert.equal(fromEdge, fromRuntime);
    assert.ok(fromEdge.length > 20000, `sheet is suspiciously small: ${fromEdge.length}`);
  }
});

test("the two vehicles produce DIFFERENT sheets — the renderer is not pinned to one", async () => {
  const { containerSvg } = await edge();
  const prius = containerSvg({ manifest: runtimeTemplate.parsePanelRows(PRIUS), ...BRAND });
  const f250 = containerSvg({ manifest: runtimeTemplate.parsePanelRows(F250), ...BRAND });
  assert.notEqual(prius, f250);
  // Its own inches, stated on its own sheet and on no other.
  assert.ok(prius.includes("165.7&quot;"), "the Prius flank inches are missing");
  assert.ok(f250.includes("251.0&quot;"), "the F250 flank inches are missing");
  assert.ok(!prius.includes("251.0&quot;"));
  assert.ok(!f250.includes("165.7&quot;"));
});

/**
 * A WHITE TAG NARROWER THAN ITS OWN FIGURE IS A WRONG NUMBER ONCE ANYTHING IS
 * BEHIND IT — and it is invisible until then.
 *
 * The height dimension is right-anchored at x-12-4 behind a knock-out. The tag
 * was a fixed 34px wide while "141.0"" measures ~34 and needs padding, so the
 * leading glyphs were drawn OUTSIDE it. On the blank template the neighbour cell
 * is white, dark ink on white read perfectly, and seven renders of this sheet
 * looked correct. Composited over the model's dark artwork the same glyphs went
 * dark-on-dark and the live sheet read "8.0"" for 68, "2.0"" for 42 and "6.0""
 * for 36 — which is exactly the figure this whole change exists to stop being
 * wrong, arriving by a completely different route.
 *
 * So the assertion is not "the tag is 34 wide". It is the two things that
 * actually have to hold, in the same units the drawing uses.
 */
test("every dimension figure fits inside its own knock-out, and clears the previous cell", async () => {
  const { containerSvg, containerLayout } = await edge();
  // The advance the drawing sizes its tags with; asserting against a LARGER
  // estimate would let a too-narrow tag through, so this deliberately over-
  // measures relative to the real face.
  const CHAR = 5.9;

  for (const rows of [PRIUS, F250]) {
    const manifest = runtimeTemplate.parsePanelRows(rows);
    const svg = containerSvg({ manifest, ...BRAND });
    const layout = containerLayout(manifest);

    for (const band of [layout.zone1, layout.zone2]) {
      band.forEach((cell, i) => {
        for (const [label, anchorX, anchored] of [
          [`${cell.heightIn.toFixed(1)}"`, cell.x - 16, "end"],
          [`${cell.widthIn.toFixed(1)}"`, cell.x + cell.w / 2, "middle"],
        ]) {
          // The tag the drawing actually emitted for this figure.
          const tag = new RegExp(
            `<rect x="(-?[\\d.]+)" y="[\\d.]+" width="([\\d.]+)" height="12" fill="#ffffff"/>`
            + `<text x="${anchorX}" [^>]*text-anchor="${anchored}"[^>]*>`
            + label.replace(/"/g, "&quot;") + `</text>`);
          const hit = tag.exec(svg);
          assert.ok(hit, `no knock-out precedes the ${anchored} figure ${label} at x=${anchorX}`);

          const [tagLeft, tagWidth] = [Number(hit[1]), Number(hit[2])];
          const ink = label.length * CHAR;
          const inkLeft = anchored === "end" ? anchorX - ink : anchorX - ink / 2;

          assert.ok(inkLeft >= tagLeft && inkLeft + ink <= tagLeft + tagWidth,
            `${label} spans ${inkLeft.toFixed(1)}..${(inkLeft + ink).toFixed(1)} but its tag covers `
            + `${tagLeft}..${tagLeft + tagWidth} — the digits outside it vanish over dark artwork`);

          // AND IT MUST NOT REACH BACKWARDS INTO THE NEIGHBOUR. A tag that fits
          // its text and sits on the previous panel punches a white hole in the
          // customer's artwork, which is the other half of the same defect.
          if (i > 0 && anchored === "end") {
            const prev = band[i - 1];
            assert.ok(tagLeft >= prev.x + prev.w,
              `the ${label} tag starts at ${tagLeft}, inside ${prev.surfaceKey} `
              + `which ends at ${prev.x + prev.w} — widen the gap with the label`);
          }
        }
      });
    }
  }
});

test("both homes agree on the cell geometry the gate measures", async () => {
  const { containerLayout } = await edge();
  for (const rows of [PRIUS, F250]) {
    const manifest = runtimeTemplate.parsePanelRows(rows);
    assert.deepEqual(containerLayout(manifest), runtimeTemplate.containerLayout(manifest));
  }
});

test("both homes refuse a manifest that is not exactly six surfaces", async () => {
  const { containerSvg } = await edge();
  const five = runtimeTemplate.parsePanelRows(PRIUS.slice(0, 5));
  assert.throws(() => containerSvg({ manifest: five, ...BRAND }),
    /atlas_container_template_needs_six_surfaces:5/);
  assert.throws(() => runtimeTemplate.containerSvg({ manifest: five, ...BRAND }),
    /atlas_container_template_needs_six_surfaces:5/);
});

/**
 * The rasteriser cannot be executed here — it is Deno + wasm, and this suite is
 * Node. What CAN be locked from the source is the set of facts whose absence
 * makes it fail silently rather than loudly, and each of these has a specific
 * failure behind it.
 */
test("the edge rasteriser carries its font and pins its wasm", () => {
  const render = readFileSync(
    join(REPO, "supabase/functions/_shared/atlas-proof-container-render.ts"), "utf8");

  // THE FONT IS EMBEDDED, NOT FETCHED. resvg has no system fonts: handed none,
  // it returns a valid PNG with no glyphs on it, and a blank teaching input is
  // the exact object RULE 0.33 removed from Call 1. A network fetch for the
  // glyphs would be a second way to arrive there.
  assert.match(render, /import \{[^}]*proofSansBytes[^}]*\} from "\.\/atlas-proof-sans\.ts"/,
    "the font must be imported as bytes, not fetched");
  assert.match(render, /fontBuffers: \[proofSansBytes\(\)\]/);
  assert.match(render, /loadSystemFonts: false/,
    "there are no system fonts here; probing for them only hides the real source");

  // AND A BLANK SHEET IS CONVICTED. If the font ever fails to attach the render
  // still succeeds, so byte size is the one cheap discriminator that separates
  // a drawn document from a white rectangle without decoding either.
  assert.match(render, /panel_proof_container_render_empty/);

  // THE WASM URL AND THE IMPORT MUST NAME THE SAME VERSION. A floating wasm
  // against a pinned module is how an ABI mismatch arrives silently.
  const imported = /@resvg\/resvg-wasm@([0-9.]+)"/.exec(render);
  const pinned = /RESVG_VERSION = "([0-9.]+)"/.exec(render);
  assert.ok(imported && pinned, "both the import and the wasm version must be pinned");
  assert.equal(imported[1], pinned[1],
    "the resvg module and its wasm binary are pinned to different versions");

  // THE DRAWING STAYS OUT OF THE RASTERISER. The template module imports
  // nothing at all, which is what lets the byte-lock above execute it without
  // instantiating wasm — and what stops a wasm failure changing a glyph.
  const template = readFileSync(
    join(REPO, "supabase/functions/_shared/atlas-proof-container-template.ts"), "utf8");
  assert.ok(!/^\s*import\s/m.test(template),
    "the container drawing must stay dependency-free");

  // IT CROSSES AS A REFERENCE (RULE 0.39) AND LANDS WHERE A CALL-1 INPUT MAY
  // LIVE, so the edge's own allowlist accepts what the edge itself drew.
  assert.match(render, /atlas-call1-inputs\/\$\{contentHash\}\.png/);
  assert.ok(!/base64|inlineData/.test(render),
    "a node handoff carries an identity, never bytes");
});

test("the embedded font decodes to the bytes it declares", async () => {
  const source = readFileSync(
    join(REPO, "supabase/functions/_shared/atlas-proof-sans.ts"), "utf8");
  const declaredSize = Number(/PROOF_SANS_BYTE_SIZE = (\d+)/.exec(source)[1]);
  const declaredHash = /PROOF_SANS_SHA256 = "([0-9a-f]{64})"/.exec(source)[1];
  const base64 = [...source.matchAll(/^\s*"([A-Za-z0-9+/=]+)",$/gm)].map((m) => m[1]).join("");
  const bytes = Buffer.from(base64, "base64");
  assert.equal(bytes.length, declaredSize);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), declaredHash);
  // A TrueType face begins with the sfnt version 0x00010000.
  assert.deepEqual([...bytes.subarray(0, 4)], [0x00, 0x01, 0x00, 0x00],
    "the embedded font is not a TrueType face");
  // Small enough that it is not the payload that kills the worker -- this
  // function has already died twice on a bodiless 504 from an oversized body.
  assert.ok(bytes.length < 64 * 1024, `the embedded font is ${bytes.length} bytes; subset it`);
});

test("the contract identity is the same string in both homes", async () => {
  const edgeMod = await edge();
  assert.equal(edgeMod.CONTAINER_CONTRACT, runtimeTemplate.CONTAINER_CONTRACT);
  assert.equal(edgeMod.WIDTH, runtimeTemplate.WIDTH);
  assert.equal(edgeMod.HEIGHT, runtimeTemplate.HEIGHT);
  // 3:2, the ratio the pinned filled reference and the request both carry.
  assert.equal(edgeMod.WIDTH / edgeMod.HEIGHT, 1.5);
});


test("artwork conditioning contains only six unlabelled destinations at the exact cutter coordinates", async () => {
  const edgeMod = await edge();
  for (const rows of [PRIUS, F250]) {
    const manifest = runtimeTemplate.parsePanelRows(rows);
    const options = { manifest, ...BRAND, mode: "artwork" };
    const svg = runtimeTemplate.containerSvg(options);
    assert.equal(svg, edgeMod.containerSvg(options));
    assert.doesNotMatch(svg, /<text|<line|stroke=|ZONE|PROOF|COMPANY/);
    assert.equal((svg.match(/<rect /g) || []).length, 7);
    for (const cell of runtimeTemplate.containerLayout(manifest).zone2) {
      assert.ok(svg.includes(`x="${cell.x}" y="${cell.y}" width="${cell.w}" height="${cell.h}"`));
    }
  }
});

test("Call 1 labels GENIE trim and print once without changing print artwork geometry", async () => {
  const { panelRowsFromManifest } = await import("../runtime/atlas-panel-proof-topology.cjs");
  const dimensions = {
    driver: [222.7, 54.43], passenger: [222.7, 54.43], roof: [63.92, 65.43],
    hood: [67.92, 47.47], front: [122.25, 34], rear: [67.92, 34.02],
  };
  const dimensionManifest = { zones: Object.entries(dimensions).map(([surfaceKey, [w, h]]) => ({
    surfaceKey, trimWidthIn: w, trimHeightIn: h, printWidthIn: w + 10, printHeightIn: h + 10,
    bleedIn: { left: 5, right: 5, top: 5, bottom: 5 },
  })) };
  const manifest = runtimeTemplate.parsePanelRows(panelRowsFromManifest(dimensionManifest));
  const options = { manifest, dimensionManifest, bleedInches: 5, companyName: "Northline Solar & Battery" };
  const actual = runtimeTemplate.containerSvg(options);
  assert.equal(actual, (await edge()).containerSvg(options), "runtime and edge must label the same inches");
  // THE OWNER'S READING ORDER (2026-09-21, against her Ridgeline gold standard):
  // the PRINTED size is the headline because it is what goes on the roll, the
  // trim follows in parentheses, and the bleed line carries the footage. The
  // wording changed; the two numbers and the "once each" contract did not.
  assert.match(actual, /232\.7&quot; W x 64\.4&quot; H/);
  assert.match(actual, /\(TRIM: 222\.7&quot; x 54\.4&quot;\)/);
  assert.doesNotMatch(actual, /242\.7&quot; W x 74\.4&quot; H/);
  // The bleed is never double-counted into the printed rectangle.
  // FOUR, not two: driver and passenger carry the same inches on this fixture,
  // so the string lands twice per band across two bands. Counting it as two was
  // my own arithmetic error, not a defect in the sheet.
  assert.equal((actual.match(/232\.7&quot; W x 64\.4&quot; H/g) || []).length, 4,
    "driver and passenger in zone 1 and again in zone 2, and nowhere else");
  const sqft = Object.values(dimensions).reduce((sum, [w, h]) => sum + w * h / 144, 0).toFixed(2);
  assert.ok(actual.includes(`TOTAL COVERAGE (TRIM): ${sqft} SQ FT`));
  // Only document labels change: both versions retain identical artwork boxes.
  assert.equal(runtimeTemplate.containerSvg({ ...options, mode: "artwork" }),
    runtimeTemplate.containerSvg({ manifest, mode: "artwork" }));
});
