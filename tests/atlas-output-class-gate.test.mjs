// CALL 1 IS A.T.L.A.S. AUTHORITY ONLY — owner ruling, Trish 2026-09-01.
//
// DCA generation 470cb0e9 proved Gemini can answer the approved Call-1 request
// with a photorealistic vehicle-mockup montage that passes every deterministic
// structural gate (a bright render measures as 94%+ artwork), after which the
// six canonical panels faithfully cut pictures of a van. These locks hold the
// repair: (1) the conditioning states the absolute output class, and (2) the
// runtime refuses an explicit vehicle-depiction verdict BEFORE the candidate
// can become canonical or fan out — while an inspector outage fails open with
// a durable receipt instead of bricking all authoring.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const runtimeRequire = createRequire(new URL("../runtime/package.json", import.meta.url));
const sharp = runtimeRequire("sharp");
const {
  classifyAtlasCandidate, OUTPUT_CLASS_CONTRACT, outputClassPrompt, surfaceTransports, FALLBACK_MODEL,
} = require("../runtime/atlas-output-class.cjs");
const runtime = readFileSync(new URL("../runtime/flat-first-atlas.cjs", import.meta.url), "utf8");
const edge = readFileSync(new URL("../supabase/functions/design-panel-ai-generate/index.ts", import.meta.url), "utf8");

async function candidatePng() {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 40, g: 90, b: 200 } } })
    .png().toBuffer();
}

function providerAnswering(json) {
  return {
    generateRaw: async () => ({ payload: { candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }] } }),
  };
}

test("an explicit vehicle-depiction verdict is BLOCKING", async () => {
  const bytes = await candidatePng();
  const { createHash } = await import("node:crypto");
  const inspectionId = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const receipt = await classifyAtlasCandidate({
    provider: providerAnswering({ inspectionId, outputClass: "vehicle_depiction", confidence: 0.97, evidence: "four rendered vans on a studio floor" }),
    bytes,
  });
  assert.equal(receipt.contract, OUTPUT_CLASS_CONTRACT);
  assert.equal(receipt.disposition, "vehicle_depiction");
  assert.equal(receipt.blocking, true);
});

test("a flat_atlas verdict passes and carries the evidence receipt", async () => {
  const bytes = await candidatePng();
  const { createHash } = await import("node:crypto");
  const inspectionId = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const receipt = await classifyAtlasCandidate({
    provider: providerAnswering({ inspectionId, outputClass: "flat_atlas", confidence: 0.9, evidence: "six flat print rectangles" }),
    bytes,
  });
  assert.equal(receipt.disposition, "flat_atlas");
  assert.equal(receipt.blocking, false);
  assert.match(receipt.evidence, /flat print rectangles/);
});

test("inspector transport failure fails OPEN with a durable unavailable receipt — never blocking", async () => {
  const bytes = await candidatePng();
  for (const provider of [
    null,
    { generateRaw: async () => { throw new Error("gemini 503"); } },
    providerAnswering({ inspectionId: "0000000000000000", outputClass: "vehicle_depiction", confidence: 1 }),
    { generateRaw: async () => ({ payload: { candidates: [{ content: { parts: [{ text: "not json" }] } }] } }) },
  ]) {
    const receipt = await classifyAtlasCandidate({ provider, bytes });
    assert.equal(receipt.disposition, "unavailable");
    assert.equal(receipt.blocking, false);
    assert.ok(receipt.code, "an unavailable receipt names its cause");
  }
});

test("the inspector question is a binary class check at temperature 0, never creative direction", () => {
  const prompt = outputClassPrompt("abcdef0123456789");
  assert.match(prompt, /OUTPUT CLASS only/);
  assert.match(prompt, /flat_atlas/);
  assert.match(prompt, /vehicle_depiction/);
  assert.doesNotMatch(prompt, /design|improve|redraw|create artwork/i);
  // 2026-09-10, New Aura (DID-664D054D): a master whose flanks were an Urus
  // side profile on a plain grey surround was classed flat_atlas and printed
  // as anatomy. The question names that shape: a vehicle-shaped island with an
  // any-colour plain surround is vehicle_depiction.
  assert.match(prompt, /vehicle-shaped island/);
  assert.match(prompt, /side profile, front or rear elevation/);
  assert.match(prompt, /plain single-colour surround \(grey, white, black or any colour\)/);
  // 2026-09-14 (owner: "Fix it"): the same question refused two Porsche
  // Martini race-livery sheets for "a side profile of a race car" and "a car's
  // front grille and headlights, and a tire tread pattern" -- the ARTWORK's
  // motifs, not a vehicle -- and on 09-06 refused a six-panel sheet because it
  // held "hood, sides, and rear" panels. Motifs, panel captions and a cut-out
  // inside continuous artwork are named as flat_atlas so the inspector convicts
  // pictures of vehicles, not livery.
  assert.match(prompt, /automotive MOTIFS drawn as graphics/);
  assert.match(prompt, /grille or headlight graphics, tire-tread or carbon patterns/);
  assert.match(prompt, /printed panel names or captions \(for example HOOD, ROOF, DRIVER, REAR\): that is the layout, not a vehicle/);
  // 2026-09-15 (owner: "look at containers, fill that"): the accepted 911
  // Turbo master shipped both flanks with a wheel-shaped void because the
  // inspector had been told a hole inside continuous artwork was fine. It runs
  // AFTER the deterministic fill now, so a void it still sees is one the fill
  // missed, and that sheet must not become canonical.
  // 2026-09-15 (owner: "it failed horribly", "its not dark"): the accepted
  // Martini 911 master (request 53276ee8) drew the CAR -- body, wheels, studio
  // floor -- inside the DRIVER and PASSENGER rectangles, on a light surround the
  // pixel gate cannot see. The motif allowance above had been read as licence
  // for that. Anatomy decides: wheels, glass, lights, mirrors, bumpers, a body
  // outline on any surround, labelled or not, livery or not, is a vehicle.
  assert.match(prompt, /VEHICLE ANATOMY: wheels or tires, wheel arches, windows, windshield or other glass, headlights or taillights, mirrors, bumpers/);
  assert.match(prompt, /whatever the surround \(white, grey, black, a studio floor or any colour\), whether or not it is labelled, and even when it carries the livery/);
  assert.match(prompt, /a race car drawn in the DRIVER rectangle is a vehicle, not a panel/);
  assert.match(prompt, /ONLY on a field of artwork that fills the rectangle edge to edge with no vehicle anatomy visible/);
  assert.match(prompt, /If ANY rectangle shows anatomy, answer vehicle_depiction/);
  assert.match(prompt, /a dark or empty OPENING where a wheel, wheel arch, window, windshield or grille would sit/);
  assert.match(prompt, /Printed vinyl has no openings; the installer cuts them/);
  assert.doesNotMatch(prompt, /is NOT this class; classify by the artwork around it/);
  assert.match(prompt, /flat_atlas requires EVERY rectangle to read as continuous print artwork edge to edge/);
  assert.doesNotMatch(prompt, /wheel-arch cut-outs or discs, bumper, grille, headlight, door or window shapes/);
  const source = readFileSync(new URL("../runtime/atlas-output-class.cjs", import.meta.url), "utf8");
  assert.match(source, /temperature: 0/);
  assert.doesNotMatch(source, /image/.source && /gemini-[a-z0-9.]*image/i);
});

test("the runtime gate refuses a vehicle-depiction candidate BEFORE canonicalization or fan-out", () => {
  const loop = runtime.slice(
    runtime.indexOf("for (let attempt = 1; attempt <= maxAuthoringAttempts"),
    runtime.indexOf("const masterStoragePath"),
  );
  // THE ZONES ARE PART OF THE CONTRACT NOW, NOT AN OPTIONAL EXTRA.
  //
  // Live efca5e03 (2026-09-18): the inspector judged the whole 4096-square
  // sheet squeezed into one 1280px JPEG, which left a driver flank ~303px
  // across its short side, and answered flat_atlas at confidence 1.0 with
  // "no visible vehicle anatomy" about a panel that is plainly a truck --
  // wheel arches, door seams, handles, mirror. The prompt already described
  // that defect almost word for word, so the failure was perception, not
  // wording. Passing the manifest zones makes the gate read each surface at
  // its own resolution and in its reading orientation. A call site that drops
  // them silently restores the blind reading.
  assert.match(loop, /classifyAtlasCandidate\(\{ provider, bytes: masterBytes, zones: manifest\.zones \}\)/);
  assert.match(loop, /flat_atlas_master_output_class_invalid/);
  // The gate runs only after the deterministic checks pass, and its refusal
  // joins the same bounded refusal path — so nothing not-A.T.L.A.S. reaches
  // the acceptance break below it.
  const deterministicIdx = loop.indexOf("deterministic.blockingFailures");
  const gateIdx = loop.indexOf("classifyAtlasCandidate");
  const breakIdx = loop.indexOf("break;");
  assert.ok(deterministicIdx > -1 && deterministicIdx < gateIdx && gateIdx < breakIdx,
    "gate order must be deterministic checks, then output class, then acceptance");
  // The accepted revision records the receipt.
  assert.match(runtime, /masterOutputClass: outputClassReceipt/);
  assert.match(runtime, /masterOutputClassContract: OUTPUT_CLASS_CONTRACT/);
});

/**
 * THE INSPECTOR READS PANELS, NOT A SQUEEZED SHEET. (Live efca5e03, 2026-09-18.)
 *
 * Measured on that run's own master: the whole-sheet transport is one 1280px
 * JPEG carrying all six surfaces, which leaves a 971 x 3712 driver flank about
 * 303px across its short side, lying on its side. The per-surface transport
 * gives the same flank 419px upright, and the squarer centre surfaces their
 * native resolution -- hood goes from ~370px to 987px.
 */
const sheetZones = [
  // A tall flank column and a centre panel, the two shapes that matter.
  { surfaceKey: "driver", x: 0, y: 0, w: 60, h: 240, extraction: { outputRotationDegrees: 90 } },
  { surfaceKey: "hood", x: 60, y: 0, w: 120, h: 120, extraction: { outputRotationDegrees: 0 } },
];

async function sheetFixture() {
  return sharp({ create: { width: 180, height: 240, channels: 4, background: "#3d6fb4" } })
    .png().toBuffer();
}

test("each surface is transported on its own, in its reading orientation", async () => {
  const parts = await surfaceTransports(await sheetFixture(), sheetZones);
  assert.equal(parts.length, 2);
  assert.deepEqual(parts.map((p) => p.surfaceKey), ["driver", "hood"]);
  const driver = await sharp(parts[0].jpeg).metadata();
  // 60x240 rotated 90 degrees reads as 240x60 -- LANDSCAPE. A flank handed to
  // the inspector on its side is a much harder question, and the rotation is
  // the same one cutCallOnePanels applies to the panel the customer receives.
  assert.ok(driver.width > driver.height,
    `the flank must arrive upright, got ${driver.width}x${driver.height}`);
  // sharp does not apply operations in call order: chaining .rotate() straight
  // into .resize() silently skips the rotation. This assertion is what catches
  // that regression -- it fails against a single-pass chain.
  assert.equal(driver.width, 240);
  assert.equal(driver.height, 60);
});

test("a zone carrying alpha transports on white, never as a black opening", async () => {
  // The prompt convicts "a dark or empty OPENING where a wheel would sit". A
  // transparent zone flattened to black would manufacture exactly that verdict.
  const transparent = await sharp({
    create: { width: 120, height: 120, channels: 4, background: "#00000000" },
  }).png().toBuffer();
  const [part] = await surfaceTransports(transparent, [
    { surfaceKey: "roof", x: 0, y: 0, w: 120, h: 120, extraction: { outputRotationDegrees: 0 } },
  ]);
  const { data, info } = await sharp(part.jpeg).raw().toBuffer({ resolveWithObject: true });
  const centre = ((info.height >> 1) * info.width + (info.width >> 1)) * info.channels;
  assert.ok(data[centre] > 200 && data[centre + 1] > 200 && data[centre + 2] > 200,
    `transparent must flatten to white, got rgb(${data[centre]},${data[centre + 1]},${data[centre + 2]})`);
});

test("the prompt tells the inspector it is looking at panels, and names them in order", () => {
  const perSurface = outputClassPrompt("abc123", ["driver", "passenger", "hood"]);
  assert.match(perSurface, /You are shown 3 images/);
  assert.match(perSurface, /driver, passenger, hood/);
  assert.match(perSurface, /Each image is one panel's rectangle at full resolution/);
  // Every class definition is unchanged -- only the framing moves, because the
  // prompt already described this defect and the failure was perception.
  assert.match(perSurface, /vehicle-shaped island/);
  assert.match(perSurface, /CLASS map_drawn/);
  // And the single-image wording is untouched for callers with no zones.
  assert.match(outputClassPrompt("abc123"), /Classify this ONE image/);
  assert.doesNotMatch(outputClassPrompt("abc123"), /You are shown/);
});

test("without zones the request is the previous single-image one", async () => {
  const bytes = await sheetFixture();
  let sent = null;
  const provider = {
    generateRaw: async ({ body }) => {
      sent = body;
      return { payload: { candidates: [{ content: { parts: [{
        text: JSON.stringify({
          inspectionId: require("node:crypto").createHash("sha256").update(bytes).digest("hex").slice(0, 16),
          outputClass: "flat_atlas", confidence: 1, anatomyRectangles: 0, evidence: "flat",
        }),
      }] } }] } };
    },
  };
  const receipt = await classifyAtlasCandidate({ provider, bytes });
  const images = sent.contents[0].parts.filter((p) => p.inlineData);
  assert.equal(images.length, 1, "no zones means exactly one whole-sheet image, as before");
  assert.equal(receipt.inspected.mode, "sheet");
});

test("the absolute output class is acceptance logic, never Call-1 authoring conditioning", () => {
  // OWNER RULING 2026-09-01: the refusal block is POST-GENERATION acceptance
  // logic only. It must never be injected into the authoring prompt, where a
  // long negative displaces creative direction and makes the model over-index
  // on the forbidden thing. The gate itself is unchanged and still blocking.
  assert.doesNotMatch(edge, /OUTPUT CLASS — ABSOLUTE/);
  assert.doesNotMatch(edge, /vehicle presentation exists only in the downstream proofing system/);
  // Both authoring scenes still state the flat output class -- in the proven
  // DesignPanelAI wording recovered from 36e5acc4, which names what the output
  // IS rather than listing what it must not be.
  const sceneMatches = edge.match(/as ONE FLAT print-production master — flat orthographic panels of pure printed vinyl artwork, never an on-vehicle photograph/g) || [];
  assert.equal(sceneMatches.length, 2, "commercial and restyle scenes both state the flat output class");
  assert.doesNotMatch(edge, /Your output is the same kind of object as this teaching proof/);
});

// ── map_drawn: THE LAYOUT MAP IS NOT ARTWORK (2026-09-16) ───────────────────
//
// The FIELD contract hands the designer its six panel rectangles as bare
// four-decimal fractions and then says "None of the map is drawn: the vinyl
// carries no numbers" -- a negative instruction standing next to the very thing
// it forbids. Four runs in a row printed those digits onto the flanks
// (455b1723, 7c7bd633, cc382c3c, 8c525565), and 8c525565's went through Topaz
// onto 150-PPI print panels: `0.9114 0.3` and `884 0.0000` printed on the
// customer's driver side. Wording did not stop it; only refusing the sheet does.

test("the inspector convicts a printed layout map, and names it apart from a drawn vehicle", () => {
  const prompt = outputClassPrompt("abc123");
  assert.match(prompt, /CLASS map_drawn/);
  assert.match(prompt, /"flat_atlas"\|"vehicle_depiction"\|"map_drawn"/);
  // It must describe the SHAPE of the defect -- a decimal fraction of the sheet
  // dropped onto the picture -- not "numbers", or it convicts every phone number.
  assert.match(prompt, /0\.9114/);
  assert.match(prompt, /leading zero and a point/);
  assert.ok(prompt.includes("belonging to no part of the artwork"));
});

test("a commercial wrap carries a phone number, and that is artwork", () => {
  const prompt = outputClassPrompt("abc123");
  const guard = prompt.slice(prompt.indexOf("NOT map_drawn"));
  for (const legitimate of ["telephone number", "street address", "web address",
    "year", "race number", "price"]) {
    assert.ok(guard.includes(legitimate), `${legitimate} must be named as artwork, never as the map`);
  }
  assert.ok(guard.includes("EXPECTED to carry a phone number"),
    "the one that would hurt most must be stated in as many words");
  assert.ok(guard.includes("not by whether numerals are present"),
    "the discriminator must be the form of the numerals, never their existence");
});

test("map_drawn blocks, flat_atlas does not, and an outage still fails open", async () => {
  const bytes = await candidatePng();
  const verdicts = [];
  const provider = {
    generateRaw: async ({ body }) => {
      const id = String(body.contents[0].parts[1].text.match(/"inspectionId":"([0-9a-f]+)"/)[1]);
      const next = verdicts.shift();
      if (next instanceof Error) throw next;
      return { payload: { candidates: [{ content: { parts: [{ text: JSON.stringify({ ...next, inspectionId: id }) }] } }] } };
    },
  };

  verdicts.push({ outputClass: "map_drawn", confidence: 1, anatomyRectangles: 0, evidence: "0.9114 printed on the flank" });
  const drawn = await classifyAtlasCandidate({ provider, bytes });
  assert.equal(drawn.disposition, "map_drawn");
  assert.equal(drawn.blocking, true, "a printed coordinate is ink on the customer's vinyl");

  verdicts.push({ outputClass: "flat_atlas", confidence: 1, anatomyRectangles: 0, evidence: "continuous artwork" });
  const clean = await classifyAtlasCandidate({ provider, bytes });
  assert.equal(clean.blocking, false);

  verdicts.push(new Error("upstream unavailable"));
  const outage = await classifyAtlasCandidate({ provider, bytes });
  assert.equal(outage.disposition, "unavailable");
  assert.equal(outage.blocking, false, "an inspector outage must never brick authoring (RULE 0.30)");
});

test("the runtime refuses a drawn map under its OWN code, so the ledger can tell the two apart", () => {
  const runtimeSrc = runtime;
  assert.match(runtimeSrc, /refusalCode = drewTheMap\s*\n\s*\? "flat_atlas_master_map_drawn"/);
  assert.match(runtimeSrc, /disposition === "map_drawn"\s*\n\s*\? "flat_atlas_master_map_drawn"/,
    "the repaired-sheet re-classification names it too");
  assert.ok(runtimeSrc.includes("a printed coordinate is ink on the customer's vinyl"));
});

test("a sheet of captioned die-cut panel shapes on a plain surround is vehicle_depiction", () => {
  // LIVE: canary 35202369855 (2026-09-17, DID-4A40563D). The accepted master was
  // a LAYOUT DRAWING -- hood, roof, door, rear and bumper silhouettes floating on
  // flat mid-grey with REAR / ROOF / HOOD printed into the artwork -- and it went
  // through Topaz onto 150-PPI print panels.
  //
  // The deterministic gate could not catch it: `holeAt` convicts near-black
  // (FLAT_BLACK_CHANNEL_MAX = 24) or transparent, and mid-grey is neither. That
  // is the colour-conditional hole RULE 0.32 names by hand.
  //
  // The inspector convicted itself in its own receipt -- outputClass flat_atlas,
  // confidence 1, evidence: "...each representing a vehicle panel (hood, roof,
  // rear, side panels) with continuous artwork filling the entire panel SHAPE,
  // and includes panel labels." It substituted the panel shape for the
  // rectangle, and the island clause named only a WHOLE-VEHICLE outline (a side
  // profile or a front/rear elevation), so a hood-shaped island never matched it.
  const prompt = outputClassPrompt("live-8c525565");

  // The island clause must reach a SINGLE PANEL's trimmed shape, not just a
  // whole vehicle.
  assert.match(prompt, /single body panel's trimmed shape: a hood, roof, door, bed side, tailgate, fender or bumper silhouette/);
  assert.match(prompt, /layout drawing of a wrap, not the printed wrap/);
  // The 2026-09-10 New Aura wording is broadened, never replaced.
  assert.match(prompt, /vehicle-shaped island/);

  // And it must survive the two things the inspector used to excuse it: correct
  // artwork inside each shape, and the captions RULE 0.35 deliberately made legal.
  assert.match(prompt, /EVEN WHEN each shape is filled with correct artwork and EVEN WHEN the shapes are captioned/);

  // The exact substitution the model made is closed by name.
  assert.match(prompt, /Filling the shape is not filling the rectangle/);
  assert.match(prompt, /Artwork that fills a PANEL SHAPE rather than the rectangle is NOT flat_atlas/);

  // The surround stays colour-agnostic -- grey is what shipped.
  assert.match(prompt, /plain single-colour surround \(grey, white, black or any colour\)/);
});

test("RULE 0.35's caption narrowing is NOT undone: captions alone are still flat_atlas", () => {
  // The 2026-09-14 ruling narrowed the inspector because it refused two Porsche
  // Martini livery sheets for their own motifs and a six-panel sheet for having
  // hood/side/rear panels. Captions on a sheet whose rectangles are filled edge
  // to edge remain the layout, not a vehicle. Only the SURROUND convicts.
  const prompt = outputClassPrompt("rule-0-35");
  assert.match(prompt, /may carry printed panel names or captions \(for example HOOD, ROOF, DRIVER, REAR\): that is the layout, not a vehicle/);
  assert.match(prompt, /automotive MOTIFS drawn as graphics/);
  assert.doesNotMatch(prompt, /captions are vehicle_depiction/i,
    "a caption alone may never convict a sheet -- that reversal cost two good Martini masters");
});

// THE STRONGER INSPECTOR, AND THE FALLBACK THAT MAKES IT SAFE (owner ruling,
// Trish 2026-09-18: "Yes stronger model").
//
// Live 34613569 was accepted with both flanks drawn as die-cut body panels on a
// flat grey surround. The prompt above already names that sheet exactly, and the
// per-surface transport was rebuilt byte-for-byte against that master's own
// zones -- the driver crop it produces is 1600x586, upright, quality 80, and
// unmistakably a hood on grey. Wording, transport and the deterministic gates
// were each eliminated rather than assumed; what was left was the model.
//
// THE FALLBACK IS THE LOAD-BEARING HALF. This gate fails OPEN, so a model the
// key pool cannot serve would not make it stricter -- it would delete the only
// semantic check allowed to refuse Call 1, silently, on every generation, and
// look exactly like an inspector outage.
async function inspectionIdFor(bytes) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

test("the strong inspector falls back to the proven one rather than failing open", async () => {
  const bytes = await candidatePng();
  const inspectionId = await inspectionIdFor(bytes);
  const asked = [];
  const provider = {
    generateRaw: async ({ model }) => {
      asked.push(model);
      if (model !== FALLBACK_MODEL) throw new Error("model not enabled for this project");
      return {
        payload: { candidates: [{ content: { parts: [{ text: JSON.stringify({
          inspectionId, outputClass: "vehicle_depiction", confidence: 1,
          evidence: "a hood silhouette on a plain grey field",
        }) }] } }] },
      };
    },
  };

  const receipt = await classifyAtlasCandidate({ provider, bytes });

  assert.equal(asked.length, 2);
  assert.notEqual(asked[0], FALLBACK_MODEL, "the strong inspector must be asked FIRST");
  assert.equal(asked[1], FALLBACK_MODEL);

  // THE GATE STILL CONVICTS -- the whole point. A strong model that cannot
  // answer must never cost a refusal the proven one would have made.
  assert.equal(receipt.disposition, "vehicle_depiction");
  assert.equal(receipt.blocking, true);

  // And the downgrade is ON THE RECORD, or a silently-downgraded gate is
  // indistinguishable from a healthy one.
  assert.equal(receipt.modelFallback.from, "gemini-2.5-pro");
  assert.ok(receipt.modelFallback.reason, "the fallback must say why the strong model did not answer");
  assert.equal(receipt.model, FALLBACK_MODEL, "the receipt names the model that actually answered");
});

test("a REAL verdict is never second-guessed by a second model", async () => {
  // Only `unavailable` falls through. Asking two models and preferring the
  // stricter would be a different gate with a different failure mode, and
  // RULE 0.30 permits exactly ONE semantic question of Call 1.
  const bytes = await candidatePng();
  const inspectionId = await inspectionIdFor(bytes);
  const asked = [];
  const provider = {
    generateRaw: async ({ model }) => {
      asked.push(model);
      return {
        payload: { candidates: [{ content: { parts: [{ text: JSON.stringify({
          inspectionId, outputClass: "flat_atlas", confidence: 1,
          evidence: "six rectangles filled corner to corner",
        }) }] } }] },
      };
    },
  };
  const receipt = await classifyAtlasCandidate({ provider, bytes });
  assert.equal(asked.length, 1, "an answered question is asked once");
  assert.equal(receipt.disposition, "flat_atlas");
  assert.equal(receipt.blocking, false);
  assert.equal(receipt.modelFallback, undefined);
});

test("the inspector is still never an image model", async () => {
  const bytes = await candidatePng();
  const receipt = await classifyAtlasCandidate({
    provider: { generateRaw: async () => { throw new Error("must not be reached"); } },
    bytes,
    model: "gemini-3-pro-image",
  });
  assert.equal(receipt.disposition, "unavailable");
  assert.equal(receipt.code, "atlas_output_class_model_invalid");
});
