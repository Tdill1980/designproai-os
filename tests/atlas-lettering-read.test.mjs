/**
 * THE LETTERING READER — read a flank panel, name every band and its reading
 * orientation, and map a mirrored band back to driver space.
 *
 * Live 8eec8162 (2026-09-15): the whole-sheet band read found ONE band on a
 * Martini livery, "PORSCHE" flipped backwards on the composed passenger flank,
 * and the proof inspector refused the passenger proof. This module is the
 * root fix: a panel-resolution read, plus a read-back of the composed panel
 * that names what is still mirrored. Every failure is a receipt, never a throw.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const runtimeRequire = createRequire(new URL("../runtime/package.json", import.meta.url));
const sharp = runtimeRequire("sharp");
const reader = require("../runtime/atlas-lettering-read.cjs");
const {
  readPanelLettering, parseLetteringRead, letteringReadPrompt,
  mirroredBandsToDriverSpace, mergeBands, DRIVER_READ_LABEL, PASSENGER_VERIFY_LABEL,
  LETTERING_READ_CONTRACT, MAX_BANDS, responseSchema, _test,
} = reader;

const panel = () => sharp({ create: { width: 400, height: 200, channels: 3, background: "#1b6fa8" } }).png().toBuffer();
const answer = (object) => ({ payload: { candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(object) }] } }] } });
const inspectionIdFromBody = (body) => body.contents[0].parts.find((p) => typeof p.text === "string").text.match(/"inspectionId":"([0-9a-f]{16})"/)[1];

test("the read is bound to the panel bytes and returns cleaned, oriented bands", async () => {
  const bytes = await panel();
  const calls = [];
  const provider = {
    generateRaw: async ({ body, label, model }) => {
      calls.push({ label, model, body });
      return answer({
        inspectionId: inspectionIdFromBody(body),
        bands: [
          { xPct: 0.1, yPct: 0.2, wPct: 0.4, hPct: 0.15, text: "PORSCHE", orientation: "forward" },
          { xPct: 0.6, yPct: 0.7, wPct: 0.3, hPct: 0.2, text: "21", orientation: "mirrored" },
          // Clamped to the panel, orientation normalised, no area -> dropped.
          { xPct: 0.9, yPct: 0.9, wPct: 0.5, hPct: 0.5, text: "MARTINI", orientation: "sideways" },
          { xPct: 0.5, yPct: 0.5, wPct: 0, hPct: 0.1, text: "empty", orientation: "forward" },
          // Live 220d569f: stripes and painted coordinates are not lettering.
          { xPct: 0.1, yPct: 0.1, wPct: 0.4, hPct: 0.2, text: "", orientation: "forward" },
          { xPct: 0.1, yPct: 0.1, wPct: 0.4, hPct: 0.2, text: "~", orientation: "forward" },
          { xPct: 0.0, yPct: 0.0, wPct: 0.7, hPct: 0.3, text: "PORSCHE", orientation: "forward" },
          { xPct: 0.0, yPct: 0.0, wPct: 0.5, hPct: 0.5, text: "PORSCHE", orientation: "forward" },
        ],
        confidence: 0.93,
      });
    },
  };
  const result = await readPanelLettering({ provider, panelBytes: bytes, surface: "driver" });
  assert.equal(result.status, "read", result.reason || "");
  assert.equal(result.contract, LETTERING_READ_CONTRACT);
  assert.equal(result.panelSha256, _test.sha256(bytes));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].label, DRIVER_READ_LABEL);
  assert.equal(calls[0].model, "gemini-2.5-flash");
  assert.equal(calls[0].body.generationConfig.temperature, 0);
  assert.equal(calls[0].body.generationConfig.responseMimeType, "application/json");
  assert.equal(calls[0].body.generationConfig.responseSchema.properties.inspectionId.type, "STRING");
  assert.equal(calls[0].body.contents[0].parts[1].inlineData.mimeType, "image/jpeg");
  assert.equal(result.bands.length, 3);
  assert.deepEqual(result.bands[0], { xPct: 0.1, yPct: 0.2, wPct: 0.4, hPct: 0.15, text: "PORSCHE", orientation: "forward" });
  assert.equal(result.bands[1].orientation, "mirrored");
  assert.equal(result.bands[2].orientation, "unknown");
  assert.ok(Math.abs(result.bands[2].wPct - 0.1) < 1e-9, "clamped to the panel's right edge");
  assert.equal(result.confidence, 0.93);
});

test("the passenger read carries its own label", async () => {
  let label = null;
  const provider = { generateRaw: async (request) => { label = request.label; return answer({ inspectionId: inspectionIdFromBody(request.body), bands: [], confidence: 1 }); } };
  const result = await readPanelLettering({ provider, panelBytes: await panel(), surface: "passenger" });
  assert.equal(result.status, "read");
  assert.equal(label, PASSENGER_VERIFY_LABEL);
  assert.deepEqual(result.bands, []);
});

test("every failure is a receipt, never a throw", async () => {
  const bytes = await panel();
  const cases = [
    ["no provider", { provider: null, panelBytes: bytes, surface: "driver" }, "atlas_lettering_transport_missing"],
    ["no panel", { provider: { generateRaw: async () => answer({}) }, panelBytes: Buffer.alloc(0), surface: "driver" }, "atlas_lettering_panel_required"],
    ["not a flank", { provider: { generateRaw: async () => answer({}) }, panelBytes: bytes, surface: "hood" }, "atlas_lettering_surface_invalid"],
    ["image model", { provider: { generateRaw: async () => answer({}) }, panelBytes: bytes, surface: "driver", model: "gemini-3-pro-image" }, "atlas_lettering_model_invalid"],
    ["seam throws", { provider: { generateRaw: async () => { throw new Error("seam exploded"); } }, panelBytes: bytes, surface: "driver" }, "atlas_lettering_reader_failed"],
    ["non-JSON", { provider: { generateRaw: async () => ({ payload: { candidates: [{ content: { parts: [{ text: "no" }] } }] } }) }, panelBytes: bytes, surface: "driver" }, "atlas_lettering_response_unparseable"],
    ["other bytes", { provider: { generateRaw: async () => answer({ inspectionId: "0000000000000000", bands: [], confidence: 1 }) }, panelBytes: bytes, surface: "driver" }, "atlas_lettering_inspection_mismatch"],
    ["no bands array", { provider: { generateRaw: async ({ body }) => answer({ inspectionId: inspectionIdFromBody(body), confidence: 1 }) }, panelBytes: bytes, surface: "driver" }, "atlas_lettering_bands_invalid"],
  ];
  for (const [label, args, code] of cases) {
    const result = await readPanelLettering(args);
    assert.equal(result.status, "unavailable", label);
    assert.equal(result.code, code, label);
    assert.deepEqual(result.bands, [], label);
  }
});

test("the prompt asks for every band with its orientation and binds the inspection id", () => {
  const prompt = letteringReadPrompt({ inspectionId: "abcdef0123456789", surface: "driver" });
  assert.match(prompt, /EVERY band of lettering/);
  assert.match(prompt, /race numbers/);
  assert.match(prompt, /"mirrored" when the letters are horizontally reversed/);
  assert.match(prompt, /"inspectionId":"abcdef0123456789"/);
  assert.match(prompt, /Do not judge quality/);
});

test("parseLetteringRead caps the band count and strips code fences", () => {
  const bands = Array.from({ length: MAX_BANDS + 5 }, (_, i) => ({ xPct: 0.01 * i, yPct: 0.1, wPct: 0.05, hPct: 0.05, text: `T${i}`, orientation: "forward" }));
  const text = "```json\n" + JSON.stringify({ inspectionId: "abcdef0123456789", bands, confidence: 2 }) + "\n```";
  const parsed = parseLetteringRead({ candidates: [{ content: { parts: [{ text }] } }] }, "abcdef0123456789");
  assert.equal(parsed.bands.length, MAX_BANDS);
  assert.equal(parsed.confidence, 1, "confidence is clamped");
});

test("a mirrored band on the passenger panel maps to its driver-space source", () => {
  // The passenger panel is the driver panel flopped: a band whose left edge
  // sits at 0.6 with width 0.3 on the passenger came from 1 - 0.6 - 0.3 = 0.1
  // on the driver. Vertical placement is untouched. Forward bands are not
  // mapped -- they are already right and need no lift.
  const mapped = mirroredBandsToDriverSpace([
    { xPct: 0.6, yPct: 0.7, wPct: 0.3, hPct: 0.2, text: "21", orientation: "mirrored" },
    { xPct: 0.1, yPct: 0.2, wPct: 0.4, hPct: 0.15, text: "PORSCHE", orientation: "forward" },
    { xPct: 0.2, yPct: 0.2, wPct: 0.1, hPct: 0.1, text: "?", orientation: "unknown" },
  ]);
  assert.equal(mapped.length, 1);
  assert.ok(Math.abs(mapped[0].xPct - 0.1) < 1e-9);
  assert.equal(mapped[0].yPct, 0.7);
  assert.equal(mapped[0].wPct, 0.3);
  assert.equal(mapped[0].hPct, 0.2);
  assert.equal(mapped[0].orientation, "forward");
  assert.equal(mapped[0].text, "21");
});

test("mergeBands keeps existing bands and adds only lettering not already covered", () => {
  const existing = [{ xPct: 0.1, yPct: 0.2, wPct: 0.4, hPct: 0.15 }];
  const merged = mergeBands(existing, [
    { xPct: 0.11, yPct: 0.2, wPct: 0.4, hPct: 0.15 }, // the same band, re-measured
    { xPct: 0.6, yPct: 0.7, wPct: 0.3, hPct: 0.2 }, // new lettering
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0], existing[0]);
  assert.equal(merged[1].xPct, 0.6);
  assert.ok(Math.abs(_test.intersectionOverUnion(existing[0], existing[0]) - 1) < 1e-9);
  assert.equal(_test.intersectionOverUnion(existing[0], { xPct: 0.9, yPct: 0.9, wPct: 0.05, hPct: 0.05 }), 0);
});

// LIVE 871a8bf1 (2026-09-15): the first schema carried enums, min/max and
// maxItems, and Gemini refused every call with "The specified schema produces
// a constraint that has too many states for serving". The reader fell back to
// the sheet read and the verify never ran. The schema is shape only; every
// constraint is the parser's.
test("the response schema carries no constraint the serving engine has to compile", () => {
  const schema = responseSchema();
  const walk = (node, path = "schema") => {
    assert.ok(!("enum" in node), `${path} must not carry enum`);
    assert.ok(!("minimum" in node) && !("maximum" in node), `${path} must not carry minimum/maximum`);
    assert.ok(!("maxItems" in node) && !("minItems" in node), `${path} must not carry maxItems/minItems`);
    for (const [key, child] of Object.entries(node.properties || {})) walk(child, `${path}.${key}`);
    if (node.items) walk(node.items, `${path}[]`);
  };
  walk(schema);
  assert.deepEqual(Object.keys(schema.properties), ["inspectionId", "bands", "confidence"]);
  assert.deepEqual(schema.properties.bands.items.required, ["xPct", "yPct", "wPct", "hPct", "text", "orientation"]);
});

test("the parser still enforces what the schema no longer does", () => {
  const text = JSON.stringify({
    inspectionId: "abcdef0123456789",
    bands: [
      { xPct: -0.2, yPct: 0.5, wPct: 0.3, hPct: 2, text: "MARTINI", orientation: "MIRRORED?" },
    ],
    confidence: 7,
  });
  const parsed = parseLetteringRead({ candidates: [{ content: { parts: [{ text }] } }] }, "abcdef0123456789");
  assert.equal(parsed.bands.length, 1);
  assert.equal(parsed.bands[0].xPct, 0, "clamped");
  assert.ok(Math.abs(parsed.bands[0].hPct - 0.5) < 1e-9, "height clamped to the panel");
  assert.equal(parsed.bands[0].wPct, 0.3);
  assert.equal(parsed.bands[0].orientation, "unknown", "unknown orientation strings normalise");
  assert.equal(parsed.confidence, 1);
  assert.throws(
    () => parseLetteringRead({ candidates: [{ content: { parts: [{ text: text.replace("abcdef0123456789", "0000000000000000") }] } }] }, "abcdef0123456789"),
    /atlas_lettering_inspection_mismatch|different bytes/,
  );
});
