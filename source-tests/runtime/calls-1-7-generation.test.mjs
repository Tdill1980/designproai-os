import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

const require = createRequire(import.meta.url);
const angles = require("../../runtime/view-angles.cjs");
const provider = require("../../runtime/generation-provider.cjs");
const serverProviderSource = readFileSync(new URL("../../runtime/designpanel-server-provider.cjs", import.meta.url), "utf8");

const okImage = (mimeType = "image/png") => ({
  candidates: [{ content: { parts: [{ inlineData: { mimeType, data: Buffer.from("render").toString("base64") } }] } }],
});
const json = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

test("the seven immutable slots keep the locked production order", () => {
  assert.deepEqual(angles.viewOrder(), ["side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof"]);
  assert.equal(angles.viewOrder().includes("hero-3d"), false);
  // Calls 8+ consume these exact slots. Changing this order or these names
  // changes the handoff, which this port is not allowed to do.
  const claimant = readFileSync(new URL("../../runtime/designpro-standalone-claimant.cjs", import.meta.url), "utf8");
  for (const view of angles.viewOrder()) assert.ok(claimant.includes(`"${view}"`), `claimant lost slot ${view}`);
});

test("passenger keeps its slot but uses the canonical passenger producer", () => {
  for (const view of angles.viewOrder().filter((value) => value !== "passenger-side")) {
    assert.equal(angles.requiresOwnGeneration(view), true);
  }
  assert.equal(angles.requiresOwnGeneration("passenger-side"), false);
  assert.throws(() => angles.requiresOwnGeneration("spoiler"), /unknown view/);
  assert.match(serverProviderSource, /producePassengerView/);
  assert.match(serverProviderSource, /generatePassengerMirror/);
  assert.match(serverProviderSource, /\.flop\(\)/);
  assert.match(serverProviderSource, /textFixUndidTheMirror/);
});

test("the passenger angle keeps its text-direction guard", () => {
  const passenger = angles.cameraAngle("passenger-side");
  assert.match(passenger, /NEVER mirrored or backwards/i);
  assert.match(passenger, /read correctly left-to-right/i);
  assert.match(passenger, /PASSENGER side/i);
  assert.equal(angles.assertTextDirectionGuard("passenger-side"), true);
  // Driver and passenger are different prompts, not one prompt reused.
  assert.notEqual(angles.cameraAngle("side"), passenger);
});

test("frozen frame contract survived the port intact", () => {
  for (const view of angles.viewOrder()) {
    assert.equal(angles.aspectRatio(view), "16:9");
    assert.equal(angles.resolutionTier(view), "4K");
    assert.ok(angles.cameraAngle(view).length > 200, `${view} angle looks truncated`);
    assert.match(angles.cameraAngle(view), /FRAME FILL|Framing|Camera/i);
  }
  assert.equal(angles.viewLabel("hood_detail"), "Hood");
});

test("the provider falls back across models and rests an unhealthy key", async () => {
  const calls = [];
  const pool = provider.createProvider({
    keys: ["key-a", "key-b"],
    models: ["gemini-3-pro-image", "gemini-3.1-flash-image"],
    fetchImpl: async (url) => {
      calls.push(url.includes("3-pro") ? "pro" : "flash");
      // Pro is over capacity on every key; flash answers.
      if (url.includes("3-pro")) return new Response("busy", { status: 429 });
      return json(okImage());
    },
  });
  const result = await pool.generateImage({ parts: [{ text: "x" }], aspectRatio: "16:9", imageSize: "4K" });
  assert.equal(result.model, "gemini-3.1-flash-image");
  assert.equal(calls.filter((c) => c === "pro").length, 2, "both keys tried on the primary model first");
  assert.ok(result.attempts.length >= 2, "the failed attempts are reported, not swallowed");
  assert.match(result.keyFingerprint, /^[0-9a-f]{12}$/);
});

test("the provider sends the passenger repair system instruction to Gemini", async () => {
  let requestBody = null;
  const pool = provider.createProvider({
    keys: ["key-a"],
    models: ["gemini-3-pro-image"],
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return json(okImage());
    },
  });
  const systemInstruction = { parts: [{ text: "preserve the camera" }] };
  await pool.generateImage({
    parts: [{ text: "repair the text" }],
    aspectRatio: "16:9",
    imageSize: "4K",
    systemInstruction,
  });
  assert.deepEqual(requestBody.systemInstruction, systemInstruction);
  assert.deepEqual(requestBody.contents[0].parts, [{ text: "repair the text" }]);
});

test("a rested key is skipped while it cools down, then returns", async () => {
  let clock = 0;
  const used = [];
  const pool = provider.createProvider({
    keys: ["key-a", "key-b"], models: ["gemini-3-pro-image"],
    now: () => clock, cooldownMs: 1000,
    fetchImpl: async (url) => {
      const key = new URL(url).searchParams.get("key");
      used.push(key);
      if (key === "key-a") return new Response("busy", { status: 429 });
      return json(okImage());
    },
  });
  await pool.generateImage({ parts: [], aspectRatio: "16:9", imageSize: "4K" });
  used.length = 0;
  await pool.generateImage({ parts: [], aspectRatio: "16:9", imageSize: "4K" });
  assert.deepEqual(used, ["key-b"], "the rested key is skipped while cooling");
  clock += 5000;
  used.length = 0;
  await pool.generateImage({ parts: [], aspectRatio: "16:9", imageSize: "4K" });
  assert.ok(used.includes("key-a"), "the key returns to rotation after cooldown");
});

test("exhausting every model and key fails loudly rather than degrading", async () => {
  const pool = provider.createProvider({
    keys: ["key-a"], models: ["gemini-3-pro-image"],
    fetchImpl: async () => new Response("nope", { status: 500 }),
  });
  await assert.rejects(() => pool.generateImage({ parts: [], aspectRatio: "16:9", imageSize: "4K", label: "driver" }),
    /driver failed on every model and key/);
});

test("a response that is not exactly one supported image is refused", async () => {
  const make = (payload) => provider.createProvider({
    keys: ["key-a"], models: ["gemini-3-pro-image"], fetchImpl: async () => json(payload),
  });
  await assert.rejects(() => make({ candidates: [{ content: { parts: [] }, finishReason: "SAFETY" }] })
    .generateImage({ parts: [], aspectRatio: "16:9", imageSize: "4K" }), /failed on every model/);
  await assert.rejects(() => make({ candidates: [{ content: { parts: [okImage().candidates[0].content.parts[0], okImage().candidates[0].content.parts[0]] } }] })
    .generateImage({ parts: [], aspectRatio: "16:9", imageSize: "4K" }), /failed on every model/);
  await assert.rejects(() => make(okImage("application/pdf"))
    .generateImage({ parts: [], aspectRatio: "16:9", imageSize: "4K" }), /failed on every model/);
});

test("the key pool accepts one key or many, and never leaks a key", () => {
  assert.equal(provider.readKeyPool({ GOOGLE_AI_API_KEY: "solo" }).length, 1);
  assert.equal(provider.readKeyPool({ GOOGLE_AI_API_KEY_POOL: "a, b ,c,a" }).length, 3, "duplicates collapse");
  assert.throws(() => provider.readKeyPool({}), /No Google AI key/);
  const pool = provider.createProvider({ keys: ["super-secret-key"], models: ["gemini-3-pro-image"], fetchImpl: async () => json(okImage()) });
  const reported = JSON.stringify(pool.state());
  assert.doesNotMatch(reported, /super-secret-key/, "health reporting must use fingerprints, never the key");
  assert.match(reported, /[0-9a-f]{12}/);
});

test("only explicit Gemini image models are accepted", () => {
  assert.deepEqual(provider.imageModels({ DESIGNPRO_IMAGE_MODELS: "gemini-3-pro-image" }), ["gemini-3-pro-image"]);
  assert.deepEqual(provider.imageModels({ GOOGLE_IMAGE_MODEL: "gemini-3-pro-image" }), ["gemini-3-pro-image"]);
  assert.deepEqual(provider.imageModels({
    DESIGNPRO_IMAGE_MODELS: "gemini-3.1-flash-image",
    GOOGLE_IMAGE_MODEL: "gemini-3-pro-image",
  }), ["gemini-3.1-flash-image"], "the DesignPro override wins over the deployment default");
  assert.throws(() => provider.imageModels({ DESIGNPRO_IMAGE_MODELS: "gemini-2.5-flash" }), /not an explicit Gemini image model/);
  assert.deepEqual(provider.imageModels({}), [...provider.DEFAULT_IMAGE_MODELS]);
  assert.deepEqual(provider.DEFAULT_IMAGE_MODELS, ["gemini-3-pro-image", "gemini-3.1-flash-image"]);
});
