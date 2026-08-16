import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

const require = createRequire(import.meta.url);
const prompts = require("../../runtime/design-prompt-os.cjs");
const angles = require("../../runtime/view-angles.cjs");
const worker = require("../../runtime/generation-worker.cjs");

const COMMERCIAL = {
  vehicle: { year: "2022", make: "Ford", model: "Transit", type: "van" },
  businessName: "HVAC Hero",
  industry: "HVAC",
  phone: "555-0142",
  brief: "Blue-to-red flame fade, heating cooling air quality, 24/7 emergency service",
  colors: ["blue", "red"],
  finish: "gloss",
};

const RESTYLE = {
  vehicle: { year: "2024", make: "Porsche", model: "911 Turbo", type: "car" },
  brief: "Distressed Martini heritage livery",
  finish: "gloss",
};

const PICKUP = {
  vehicle: { year: "2022", make: "Ford", model: "F-250 Crew Cab", type: "truck" },
  businessName: "Flamingo Pools",
  brief: "Sunset pool and patio scene",
  finish: "gloss",
};

const reproductionViews = () => angles.viewOrder().filter((view) => angles.reproducesHero(view));

test("the hero originates and the other six reproduce — that is the design contract", () => {
  assert.equal(angles.HERO_VIEW, "side");
  assert.equal(angles.originatesDesign("side"), true);
  assert.equal(reproductionViews().length, 6);
  for (const view of reproductionViews()) assert.equal(angles.originatesDesign(view), false);

  // Reproducing the hero is NOT the same claim as not being generated. Every
  // view still gets its own render; conflating the two is how a passenger side
  // becomes a horizontal flip with backwards lettering.
  for (const view of angles.viewOrder()) assert.equal(angles.requiresOwnGeneration(view), true);
  assert.throws(() => angles.reproducesHero("spoiler"), /unknown view/);
});

test("the hero is hoisted to the front of any plan", () => {
  // runRequest executes slots in order, so a plan that reached the engine with
  // a reproduction view first would ask for a clone of an image that does not
  // exist yet.
  assert.deepEqual(angles.heroFirstOrder(["roof", "front", "side"]), ["side", "roof", "front"]);
  assert.deepEqual(angles.heroFirstOrder(), angles.viewOrder());
  assert.deepEqual(angles.heroFirstOrder(["roof", "front"]), ["roof", "front"]);
});

test("commercial and restyle are different designers, chosen from the request", () => {
  assert.equal(prompts.designMode(COMMERCIAL), "commercial");
  assert.equal(prompts.designMode(RESTYLE), "restyle");
  // An explicit mode still wins over inference.
  assert.equal(prompts.designMode({ ...RESTYLE, mode: "commercial" }), "commercial");

  const commercial = prompts.buildHeroPrompt({ input: COMMERCIAL, sourceViewType: "side" });
  const restyle = prompts.buildHeroPrompt({ input: RESTYLE, sourceViewType: "side" });
  assert.match(commercial, /senior graphic designer at a sign and wrap company/);
  assert.match(restyle, /Lead Vehicle Wrap Designer/);
  // The commercial path must ask for a logo and must not prescribe its form —
  // every version that named a form gave unrelated trades the same lockup.
  assert.match(commercial, /This business needs its own logo/);
  assert.doesNotMatch(commercial, /wordmark|custom, distinctive lettering/i);
  // The restyle path designs the wrap; branding is a separate layer.
  assert.doesNotMatch(restyle, /This business needs its own logo/);
});

test("the customer's raw brief reaches the designer unrewritten", () => {
  const hero = prompts.buildHeroPrompt({ input: COMMERCIAL, sourceViewType: "side" });
  assert.ok(hero.includes(COMMERCIAL.brief), "the brief was rewritten or templated on the way in");
  assert.match(hero, /HVAC Hero/);
});

test("an absent phone number is never invented", () => {
  const withPhone = prompts.buildHeroPrompt({ input: COMMERCIAL, sourceViewType: "side" });
  assert.match(withPhone, /555-0142 — display this EXACT number, digit for digit/);

  const { phone, ...noPhone } = COMMERCIAL;
  const built = prompts.buildHeroPrompt({ input: noPhone, sourceViewType: "side" });
  // An invented number is a real number belonging to someone else, printed on a
  // real vehicle.
  assert.match(built, /do NOT invent, fabricate, or display any phone number/);
});

test("photo realism is explicit-request-only", () => {
  // Scene words alone never flip it: a customer can want a stylized ranch.
  assert.equal(prompts.briefWantsPhoto("sunset over the ranch, cabin, mountains"), false);
  assert.equal(prompts.briefWantsPhoto("realistic flames"), false);
  assert.equal(prompts.briefWantsPhoto("a photo of a tech installing an AC"), true);
  assert.equal(prompts.briefWantsPhoto("photorealistic mountain scene"), true);
  assert.equal(prompts.briefWantsPhoto("lifelike wildlife"), true);

  const stylized = prompts.buildHeroPrompt({ input: PICKUP, sourceViewType: "side" });
  assert.doesNotMatch(stylized, /PHOTOGRAPHIC IMAGERY/);
  const photo = prompts.buildHeroPrompt({
    input: { ...PICKUP, brief: "a photo of a sunset pool and patio" },
    sourceViewType: "side",
  });
  assert.match(photo, /PHOTOGRAPHIC IMAGERY/);
});

test("the studio kernel and the frozen camera angle are in every prompt", () => {
  for (const view of angles.viewOrder()) {
    const built = angles.originatesDesign(view)
      ? prompts.buildHeroPrompt({ input: COMMERCIAL, sourceViewType: view })
      : prompts.buildReproductionPrompt({ input: COMMERCIAL, sourceViewType: view });
    assert.ok(built.includes("HIGH-END WRAP SHOP ENVIRONMENT"), `${view} lost the studio kernel`);
    assert.ok(built.includes(angles.cameraAngle(view).trim()), `${view} lost its frozen camera angle`);
    // Said once. Repeating an instruction splits the model's attention and
    // costs prompt budget the design needs.
    assert.equal(built.split("HIGH-END WRAP SHOP ENVIRONMENT").length - 1, 1, `${view} stacks the studio twice`);
  }
});

test("the passenger reproduction keeps its text-direction guard", () => {
  const passenger = prompts.buildReproductionPrompt({ input: COMMERCIAL, sourceViewType: "passenger-side" });
  assert.match(passenger, /NEVER mirrored or backwards/i);
  assert.match(passenger, /read correctly left-to-right/i);
});

test("a reproduction view is told to clone the hero, never to invent", () => {
  const repro = prompts.buildReproductionPrompt({
    input: COMMERCIAL,
    sourceViewType: "rear",
    designAnchorText: "Blue nose fading to red tail; HVAC Hero shield centred on the rear door.",
  });
  assert.match(repro, /The attached reference image shows this EXACT wrap design/);
  assert.match(repro, /Render the SAME vehicle with the SAME wrap design/);
  assert.match(repro, /DESIGN CONTINUITY — match this driver-side description exactly/);
  // Elevation belongs to the hero. Telling a clone to amplify is telling it to
  // diverge from the thing it is cloning.
  assert.doesNotMatch(repro, /DESIGN AMPLIFICATION/);
  // The full coverage block runs on this path (it does not on the hero path).
  assert.match(repro, /WRAP COVERAGE — MANDATORY/);
});

test("a commercial hood and roof are not told to drop the branding they carry", () => {
  // The source hard-codes the RESTYLE scene text for every secondary view, so a
  // commercial hood is told "No text, no logos, no branding" while its own
  // reference image plainly shows the lockup. Both scene texts exist in the
  // source; the mode picks between them here.
  for (const view of ["hood_detail", "roof"]) {
    const commercial = prompts.buildReproductionPrompt({ input: COMMERCIAL, sourceViewType: view });
    assert.doesNotMatch(commercial, /No text, no logos, no branding/);
    assert.match(commercial, /company branding/);

    const restyle = prompts.buildReproductionPrompt({ input: RESTYLE, sourceViewType: view });
    assert.match(restyle, /No text, no logos, no branding/);
  }
});

test("hood, roof and front carry the continuity lock; nothing carries it twice", () => {
  for (const view of ["hood_detail", "roof", "front"]) {
    const built = prompts.buildReproductionPrompt({ input: COMMERCIAL, sourceViewType: view });
    assert.match(built, /HOOD\/ROOF CONTINUITY \(NON-NEGOTIABLE\)/);
    // DESIGN PLACEMENT makes the same demand; on these three it is a duplicate.
    assert.doesNotMatch(built, /DESIGN PLACEMENT/);
  }
  const rear = prompts.buildReproductionPrompt({ input: COMMERCIAL, sourceViewType: "rear" });
  assert.doesNotMatch(rear, /HOOD\/ROOF CONTINUITY/);
  assert.match(rear, /DESIGN PLACEMENT/);
});

test("the pickup bed clause fires on pickups and nowhere else", () => {
  const pickup = prompts.buildHeroPrompt({ input: PICKUP, sourceViewType: "side" });
  assert.match(pickup, /the open bed interior stays bare factory bedliner/);
  const van = prompts.buildHeroPrompt({ input: COMMERCIAL, sourceViewType: "side" });
  assert.doesNotMatch(van, /bedliner/);
});

test("VisionBoard grounding is honoured, and exact_reference stops the amplifier", () => {
  const inspiration = prompts.buildHeroPrompt({
    input: { ...RESTYLE, visionBoardImages: [{ storageUrl: "https://example.test/ref.png" }] },
    sourceViewType: "side",
  });
  assert.match(inspiration, /STYLE INSPIRATION/);
  assert.match(inspiration, /DESIGN AMPLIFICATION/);

  const exact = prompts.buildHeroPrompt({
    input: {
      ...RESTYLE,
      visionBoardImages: [{ storageUrl: "https://example.test/ref.png" }],
      visionboard_intent: "exact_reference",
    },
    sourceViewType: "side",
  });
  assert.match(exact, /EXACT REFERENCE \(REPRODUCE, DO NOT REDESIGN\)/);
  // Amplifying a design the customer asked to be copied is how "it created a
  // different design" happens.
  assert.doesNotMatch(exact, /DESIGN AMPLIFICATION/);

  // An uploaded reference with no bytes resolved is grounding text only; with
  // bytes it must actually travel to the model as an image.
  const withBytes = prompts.promptPartsFor({
    input: {
      ...RESTYLE,
      visionBoardImages: [{ storageUrl: "https://example.test/ref.png", bytes: Buffer.from("ref"), contentType: "image/png" }],
    },
    sourceViewType: "side",
  });
  assert.equal(withBytes.length, 2);
  assert.equal(withBytes[0].inlineData.mimeType, "image/png");
});

test("a reproduction view refuses to render without the hero attached", () => {
  // Silently falling through to a text-only prompt would turn this slot into a
  // seventh independent invention, which is exactly the defect being fixed.
  assert.throws(
    () => prompts.promptPartsFor({ input: COMMERCIAL, sourceViewType: "rear" }),
    /hero reference is required/,
  );
  const parts = prompts.promptPartsFor({
    input: COMMERCIAL,
    sourceViewType: "rear",
    heroReference: { bytes: Buffer.from("hero-bytes"), contentType: "image/png" },
    designAnchorText: "anchor",
  });
  // Reference FIRST: the model reads the design before it reads the instruction.
  assert.ok(parts[0].inlineData, "the hero reference must lead the parts");
  assert.equal(parts[0].inlineData.data, Buffer.from("hero-bytes").toString("base64"));
  assert.ok(parts[1].text.includes("anchor"));
  // Full resolution. The source downsizes to 512px as an edge-function memory
  // workaround; this runtime has real memory and must not inherit the crutch.
  const source = readFileSync(new URL("../../runtime/design-prompt-os.cjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /width=512|resize=contain/);
});

test("the worker plans all seven but can only assemble the hero first", () => {
  // The ORDER of all seven is knowable up front; the PROMPTS are not, because
  // six of them need the hero image as a prompt part. Keeping those two things
  // separate is what makes the two-phase run possible.
  const plan = worker.planFrom(null);
  assert.deepEqual(plan.map((entry) => entry.sourceViewType), angles.viewOrder());
  assert.equal(plan[0].sourceViewType, angles.HERO_VIEW);
  assert.deepEqual(
    worker.planFrom([{ sourceViewType: "roof" }, { sourceViewType: "side" }]).map((e) => e.sourceViewType),
    ["side", "roof"],
  );

  const heroSlot = worker.slotsFrom([{ sourceViewType: angles.HERO_VIEW }], COMMERCIAL, {})[0];
  assert.equal(heroSlot.sourceViewType, angles.HERO_VIEW);
  assert.equal(heroSlot.aspectRatio, "16:9");
  assert.equal(heroSlot.imageSize, "4K");
  assert.equal(heroSlot.promptParts.length, 1, "the hero prompt is text only");

  // Assembling ANY reproduction slot before the hero exists is refused, so the
  // two-phase order cannot be skipped by accident.
  assert.throws(() => worker.slotsFrom([{ sourceViewType: "roof" }], COMMERCIAL, {}), /hero reference is required/);
  assert.throws(() => worker.slotsFrom(null, COMMERCIAL, {}), /hero reference is required/);

  const reproduced = worker.slotsFrom(
    [{ sourceViewType: "roof", consumerRole: "roof" }],
    COMMERCIAL,
    {},
    { heroReference: { bytes: Buffer.from("hero"), contentType: "image/png" }, designAnchorText: "anchor" },
  );
  assert.equal(reproduced.length, 1);
  assert.equal(reproduced[0].consumerRole, "roof");
  assert.ok(reproduced[0].promptParts[0].inlineData);
});

test("an operator's per-view instruction reaches both contracts", () => {
  const hero = worker.slotsFrom([{ sourceViewType: angles.HERO_VIEW }], COMMERCIAL, { side: "bolder flames" })[0];
  assert.match(hero.promptParts.at(-1).text, /Revision requested for this view: bolder flames/);

  const repro = worker.slotsFrom(
    [{ sourceViewType: "rear" }],
    COMMERCIAL,
    { rear: "raise the logo" },
    { heroReference: { bytes: Buffer.from("hero"), contentType: "image/png" } },
  )[0];
  assert.match(repro.promptParts.at(-1).text, /Revision requested for this view: raise the logo/);
});

test("every assembled prompt stays inside its measured length ceiling", () => {
  // Prompt length is a quality ceiling for this model, not a style preference:
  // a 15K prompt once produced visibly blurry renders. These bounds are the
  // measured worst case, frozen so bloat cannot creep back.
  const anchor = "x".repeat(prompts.MAX_ANCHOR_CHARS * 2);
  for (const input of [COMMERCIAL, RESTYLE, PICKUP]) {
    const hero = prompts.buildHeroPrompt({ input, sourceViewType: angles.HERO_VIEW });
    assert.ok(hero.length <= prompts.HERO_PROMPT_CHAR_CEILING, `hero prompt is ${hero.length} chars`);
    for (const view of reproductionViews()) {
      const built = prompts.buildReproductionPrompt({ input, sourceViewType: view, designAnchorText: anchor });
      assert.ok(
        built.length <= prompts.REPRODUCTION_PROMPT_CHAR_CEILING,
        `${view} reproduction prompt is ${built.length} chars`,
      );
      // A runaway anchor can never be the reason.
      assert.ok(built.includes("x".repeat(prompts.MAX_ANCHOR_CHARS)));
      assert.ok(!built.includes("x".repeat(prompts.MAX_ANCHOR_CHARS + 1)));
    }
  }
});

test("the design anchor is best-effort and never fails a request", async () => {
  const logged = [];
  const failing = {
    generateSpecification: async () => { throw new Error("provider_specification_exhausted"); },
  };
  assert.equal(
    await prompts.buildDesignAnchor({ provider: failing, heroBytes: Buffer.from("hero"), logger: (line) => logged.push(line) }),
    "",
  );
  assert.match(logged.join(" "), /design anchor unavailable/);

  const ok = {
    generateSpecification: async ({ parts, temperature }) => {
      // Temperature 0: the anchor is a description of what exists, not a
      // creative act.
      assert.equal(temperature, 0);
      assert.ok(parts.some((part) => part.inlineData), "the hero image must be attached to the analysis");
      return { specification: { anchor: "Blue nose fading to red tail." } };
    },
  };
  assert.equal(
    await prompts.buildDesignAnchor({ provider: ok, heroBytes: Buffer.from("hero") }),
    "Blue nose fading to red tail.",
  );
});

// ---------------------------------------------------------------------------
// THE ORDERING GUARANTEE, end to end.
//
// Everything above proves the prompts are right in isolation. This proves the
// worker actually runs them in the only order that works: hero first, its real
// bytes attached to all six reproductions. A regression that reverted to one
// flat seven-slot run would still pass every assertion above.
// ---------------------------------------------------------------------------

const HERO_BYTES = Buffer.from("hero-render-bytes");

function claimFor(input = COMMERCIAL) {
  return {
    requestId: "10000000-0000-4000-8000-000000000001",
    generationId: "90000000-0000-4000-8000-000000000009",
    tenantKey: "user_20000000-0000-4000-8000-000000000002",
    input,
    viewPlan: null,
  };
}

/** A runner that records the slots it was handed and accepts every one. */
function recordingRunner(phases, { failHero = false } = {}) {
  return async ({ slots }) => {
    phases.push(slots);
    if (failHero && slots.some((slot) => angles.originatesDesign(slot.sourceViewType))) {
      return {
        state: "failed",
        providerCalls: 4,
        results: slots.map((slot) => ({ sourceViewType: slot.sourceViewType, state: "failed", reason: "provider_attempts_exhausted" })),
      };
    }
    return {
      state: "outputs_ready",
      providerCalls: slots.length,
      results: slots.map((slot) => ({
        sourceViewType: slot.sourceViewType,
        state: "accepted",
        winner: { storage_path: `p/${slot.sourceViewType}.png`, content_type: "image/png", content_hash: "f".repeat(64) },
      })),
    };
  };
}

test("the worker runs the hero alone, then reproduces it onto the other six", async () => {
  const phases = [];
  const reads = [];
  const result = await worker.runSevenSlots({
    claim: claimFor(),
    provider: { generateSpecification: async () => ({ specification: { anchor: "Blue nose, red tail." } }) },
    store: {},
    runner: recordingRunner(phases),
    readBytes: async (path) => { reads.push(path); return HERO_BYTES; },
  });

  assert.equal(result.state, "outputs_ready");
  assert.equal(result.results.length, 7);
  assert.equal(result.designAnchored, true);

  // TWO phases, not one. One flat run of seven is the defect.
  assert.equal(phases.length, 2);
  assert.deepEqual(phases[0].map((slot) => slot.sourceViewType), [angles.HERO_VIEW]);
  assert.deepEqual(
    phases[1].map((slot) => slot.sourceViewType),
    angles.viewOrder().filter((view) => view !== angles.HERO_VIEW),
  );

  // The hero was read back from storage exactly once and its real bytes reached
  // all six — not a description of it, not a resized copy, not a URL.
  assert.deepEqual(reads, [`p/${angles.HERO_VIEW}.png`]);
  for (const slot of phases[1]) {
    assert.ok(slot.promptParts[0]?.inlineData, `${slot.sourceViewType} rendered without the hero attached`);
    assert.equal(slot.promptParts[0].inlineData.data, HERO_BYTES.toString("base64"));
    assert.match(slot.promptParts[1].text, /Blue nose, red tail\./);
  }
  // The hero itself is text only — it has nothing to reproduce.
  assert.equal(phases[0][0].promptParts.length, 1);
});

test("a hero that never lands stops the six rather than letting them invent", async () => {
  const phases = [];
  const result = await worker.runSevenSlots({
    claim: claimFor(),
    provider: {},
    store: {},
    runner: recordingRunner(phases, { failHero: true }),
    readBytes: async () => { throw new Error("must not read a hero that does not exist"); },
  });
  assert.equal(result.state, "failed");
  assert.equal(phases.length, 1, "the reproduction phase ran without a hero");
  assert.equal(result.results.length, 1);
});

test("a plan with no hero is refused, not silently reproduced from nothing", async () => {
  await assert.rejects(
    worker.runSevenSlots({
      claim: { ...claimFor(), viewPlan: [{ sourceViewType: "roof" }, { sourceViewType: "front" }] },
      provider: {},
      store: {},
      runner: recordingRunner([]),
      readBytes: async () => HERO_BYTES,
    }),
    /carries no hero view/,
  );
});

test("a failed design anchor still ships the six, carried by the hero image alone", async () => {
  const phases = [];
  const result = await worker.runSevenSlots({
    claim: claimFor(RESTYLE),
    provider: { generateSpecification: async () => { throw new Error("provider_specification_exhausted"); } },
    store: {},
    runner: recordingRunner(phases),
    readBytes: async () => HERO_BYTES,
  });
  assert.equal(result.state, "outputs_ready");
  assert.equal(result.designAnchored, false);
  assert.equal(phases.length, 2);
  for (const slot of phases[1]) {
    assert.ok(slot.promptParts[0]?.inlineData);
    assert.doesNotMatch(slot.promptParts[1].text, /DESIGN CONTINUITY/);
  }
});
