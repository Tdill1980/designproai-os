import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
// CI installs Sharp under runtime/, where production resolves it. Resolve the
// fixture builder from that exact dependency tree instead of depending on an
// incidental root-level install.
const runtimeRequire = createRequire(new URL("../runtime/package.json", import.meta.url));
const sharp = runtimeRequire("sharp");
const {
  SERVER_PROVIDER_CONTRACT,
  createDesignPanelServerProvider,
  generatePassengerMirror,
  inspectStandardProof,
  orientationVerdict,
  passengerFramingVerdict,
  producePassengerView,
} = require("../runtime/designpanel-server-provider.cjs");

function qualityPayload(inspectionId, overrides = {}) {
  return {
    candidates: [{
      finishReason: "STOP",
      content: { parts: [{ text: JSON.stringify({
        inspectionId,
        cameraPass: true,
        vehiclePass: true,
        customerTextPass: true,
        logoPass: true,
        requestedPhotoPass: true,
        professionalDesignPass: true,
        photorealismPass: true,
        studioPass: true,
        wrapCoveragePass: true,
        pickupBedPass: true,
        confidence: 0.96,
        reasons: [],
        ...overrides,
      }) }] },
    }],
  };
}

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const GENERATION_ID = "33333333-3333-4333-8333-333333333333";
const TENANT_KEY = `user_${OWNER_ID}`;

async function asymmetricDriverFixture() {
  const left = await sharp({ create: { width: 320, height: 360, channels: 3, background: "#f39c12" } }).png().toBuffer();
  const right = await sharp({ create: { width: 320, height: 360, channels: 3, background: "#204a87" } }).png().toBuffer();
  return sharp({ create: { width: 640, height: 360, channels: 3, background: "#111111" } })
    .composite([{ input: left, left: 0, top: 0 }, { input: right, left: 320, top: 0 }])
    .png()
    .toBuffer();
}

function textRepairProvider(bytes, overrides = {}) {
  return {
    generateImage: async () => ({
      bytes,
      contentType: "image/jpeg",
      model: "gemini-text-repair",
      keyFingerprint: "0123456789ab",
      attempts: [],
      ...overrides,
    }),
  };
}

test("Standard semantic QC binds the actual proof and enforces photo, branding, coverage, and truck-bed checks", async () => {
  const bytes = await asymmetricDriverFixture();
  let body;
  const review = await inspectStandardProof({
    provider: {
      generateRaw: async (call) => {
        body = call.body;
        const prompt = call.body.contents[0].parts[1].text;
        const inspectionId = prompt.match(/Inspection identity: ([0-9a-f]{64})/)?.[1];
        return { payload: qualityPayload(inspectionId) };
      },
    },
    input: {
      brief: "Use a real photo of a swimming pool",
      companyName: "Flamingo Pools",
      phone: "(602) 555-1212",
      website: "flamingopools.example",
      vehicle: { year: "2022", make: "Ford", model: "F-150 Crew Cab", type: "truck" },
    },
    sourceViewType: "side",
    bytes,
  });
  assert.equal(review.confidence, 0.96);
  const prompt = body.contents[0].parts[1].text;
  assert.match(prompt, /real high-resolution photograph/);
  assert.match(prompt, /open bed floor, inner walls, rails and wheel-well humps/);
  assert.match(prompt, /generic\/stock\/template branding/);
  assert.match(prompt, /backwards, misspelled, replaced or unreadable/);
});

test("Standard semantic QC rejects AI slop or artwork inside a pickup bed", async () => {
  const bytes = await asymmetricDriverFixture();
  await assert.rejects(() => inspectStandardProof({
    provider: {
      generateRaw: async (call) => {
        const prompt = call.body.contents[0].parts[1].text;
        const inspectionId = prompt.match(/Inspection identity: ([0-9a-f]{64})/)?.[1];
        return { payload: qualityPayload(inspectionId, {
          professionalDesignPass: false,
          pickupBedPass: false,
          reasons: ["generic logo", "artwork is visible on the bedliner"],
        }) };
      },
    },
    input: {
      brief: "premium pool company wrap",
      companyName: "Flamingo Pools",
      vehicle: { year: "2022", make: "Ford", model: "F-150", type: "truck" },
    },
    sourceViewType: "side",
    bytes,
  }), (error) => error.code === "designpanel_quality_rejected"
    && /professionalDesignPass/.test(error.message)
    && /pickupBedPass/.test(error.message));
});

async function fixture(overrides = {}) {
  const heroBytes = await sharp(await asymmetricDriverFixture()).resize(1600, 900, { fit: "fill" }).png().toBuffer();
  const heroHash = createHash("sha256").update(heroBytes).digest("hex");
  const heroPath = `designpro/${TENANT_KEY}/${GENERATION_ID}/calls-1-7/side/${heroHash}.png`;
  const heroRow = {
    storage_path: heroPath,
    content_hash: heroHash,
    byte_size: heroBytes.length,
    content_type: "image/png",
    ...overrides,
  };
  const supabase = {
    storage: { from: () => ({ download: async () => ({ data: new Blob([heroBytes]), error: null }) }) },
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        maybeSingle: async () => ({ data: heroRow, error: null }),
      };
      return chain;
    },
  };
  return { heroBytes, heroHash, heroPath, heroRow, supabase };
}

test("Standard DesignPanel runs designer then anchored photographer directly on the server", async () => {
  const { heroHash, heroPath, supabase } = await fixture();
  const calls = [];
  const directProvider = {
    models: ["gemini-3-pro-image"],
    keyCount: 2,
    generateImage: async (call) => {
      calls.push(call);
      if (call.parts?.[0]?.inlineData?.data) {
        return {
          bytes: Buffer.from(call.parts[0].inlineData.data, "base64"),
          contentType: call.parts[0].inlineData.mimeType,
          model: "gemini-3-pro-image",
          keyFingerprint: "0123456789ab",
          attempts: [],
        };
      }
      const color = calls.length === 1 ? "#1e88e5" : "#ef6c00";
      return {
        bytes: await sharp({ create: { width: 1024, height: 576, channels: 3, background: color } }).png().toBuffer(),
        contentType: "image/png",
        model: "gemini-3-pro-image",
        keyFingerprint: "0123456789ab",
        attempts: [],
      };
    },
  };
  const provider = createDesignPanelServerProvider({
    supabase, provider: directProvider, requestId: REQUEST_ID,
    generationId: GENERATION_ID, tenantKey: TENANT_KEY,
    input: {
      brief: "Deep blue pool-water wrap",
      designName: "Flamingo Pools",
      finish: "Gloss",
      vehicle: { year: "2024", make: "Ford", model: "F-250" },
    },
  });

  const designer = await provider.generateImage({
    sourceViewType: "side", parts: [{ text: "server A.C.E. DesignIQ prompt" }],
    aspectRatio: "16:9", imageSize: "4K", attempt: 1,
  });
  const photographer = await provider.generateImage({
    sourceViewType: "passenger-side", parts: [{ text: "must be replaced" }],
    aspectRatio: "16:9", imageSize: "4K", attempt: 2,
  });

  assert.equal(provider.contract, SERVER_PROVIDER_CONTRACT);
  assert.equal(provider.maxProviderAttempts, 4);
  assert.equal(provider.keyCount, 2);
  assert.equal(designer.metadata.stage, "design-panel-ai-generate");
  assert.equal(designer.metadata.execution, "server-native");
  assert.equal(photographer.metadata.stage, "generate-color-render");
  assert.equal(photographer.metadata.execution, "server-native");
  assert.equal(photographer.metadata.heroStoragePath, heroPath);
  assert.equal(photographer.metadata.heroContentHash, heroHash);
  assert.equal(photographer.metadata.passengerProducer, "producePassengerView");
  assert.equal(photographer.metadata.deterministicMirror, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].parts[0].text, "server A.C.E. DesignIQ prompt");
  assert.equal(calls[1].temperature, 1);
  assert.equal(calls[1].responseModalities.join(","), "TEXT,IMAGE");
  assert.equal(calls[1].parts.length, 2);
  assert.equal(calls[1].parts[0].inlineData.mimeType, "image/jpeg");
  assert.match(calls[1].parts[1].text, /horizontally mirrored vehicle wrap/i);
  assert.match(calls[1].parts[1].text, /KEEP THE FRAMING IDENTICAL/i);
  assert.equal(calls[1].timeoutMs, 90_000);
  assert.match(calls[1].systemInstruction.parts[0].text, /ABSOLUTE RULE 2 \(CAMERA \+ VEHICLE\)/);
});

test("server photographer refuses View 1 bytes that drift from their frozen identity", async () => {
  const { supabase } = await fixture({ content_hash: "f".repeat(64) });
  const provider = createDesignPanelServerProvider({
    supabase,
    provider: { generateImage: async () => { throw new Error("must not call provider"); } },
    requestId: REQUEST_ID, generationId: GENERATION_ID, tenantKey: TENANT_KEY,
    input: { vehicle: { year: "2024", make: "Ford", model: "F-250" } },
  });
  await assert.rejects(
    () => provider.generateImage({ sourceViewType: "rear", attempt: 1 }),
    (error) => error?.code === "designpanel_server_hero_hash_mismatch" && error.retryable === false,
  );
});

test("server photographer refuses a View 1 path outside this generation", async () => {
  const { supabase } = await fixture({ storage_path: "renders/someone-else/hero.png" });
  const provider = createDesignPanelServerProvider({
    supabase,
    provider: { generateImage: async () => { throw new Error("must not call provider"); } },
    requestId: REQUEST_ID, generationId: GENERATION_ID, tenantKey: TENANT_KEY,
    input: { vehicle: { year: "2024", make: "Ford", model: "F-250" } },
  });
  await assert.rejects(
    () => provider.generateImage({ sourceViewType: "roof", attempt: 1 }),
    (error) => error?.code === "designpanel_server_hero_identity_invalid" && error.retryable === false,
  );
});

test("the canonical passenger mirror caps, flips, and encodes the driver image", async () => {
  const left = await sharp({ create: { width: 1600, height: 1800, channels: 3, background: "#ef2929" } }).png().toBuffer();
  const right = await sharp({ create: { width: 1600, height: 1800, channels: 3, background: "#204a87" } }).png().toBuffer();
  const driver = await sharp({ create: { width: 3200, height: 1800, channels: 3, background: "#ffffff" } })
    .composite([{ input: left, left: 0, top: 0 }, { input: right, left: 1600, top: 0 }])
    .png()
    .toBuffer();

  const passenger = await generatePassengerMirror(driver);
  const metadata = await sharp(passenger).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, 2560);
  assert.equal(metadata.height, 1440);

  const { data, info } = await sharp(passenger).raw().toBuffer({ resolveWithObject: true });
  const pixel = (x, y) => {
    const offset = (y * info.width + x) * info.channels;
    return [data[offset], data[offset + 1], data[offset + 2]];
  };
  const mirroredLeft = pixel(100, 700);
  const mirroredRight = pixel(2460, 700);
  assert.ok(mirroredLeft[2] > mirroredLeft[0], "the driver's blue right half did not move left");
  assert.ok(mirroredRight[0] > mirroredRight[2], "the driver's red left half did not move right");
});

test("the canonical passenger mirror sizes the browser-visible EXIF orientation", async () => {
  const driver = await sharp({ create: { width: 1600, height: 3200, channels: 3, background: "#1565c0" } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();

  const passenger = await generatePassengerMirror(driver);
  const metadata = await sharp(passenger).metadata();
  assert.equal(metadata.width, 2560);
  assert.equal(metadata.height, 1280);
});

test("the existing 64x32 passenger orientation verdict keeps its 10% margin", () => {
  const driver = [0, 64, 192, 255];
  assert.equal(orientationVerdict(driver, driver, 4, 1), true);
  assert.equal(orientationVerdict(driver, [...driver].reverse(), 4, 1), false);
  assert.equal(orientationVerdict([0, 64, 64, 0], [0, 64, 64, 0], 4, 1), null);
  assert.equal(orientationVerdict(null, driver, 4, 1), null);
});

test("passenger text repair may not undo the deterministic mirror", async () => {
  const driver = await sharp({ create: { width: 640, height: 360, channels: 3, background: "#111111" } })
    .composite([{
      input: await sharp({ create: { width: 180, height: 240, channels: 3, background: "#f4d03f" } }).png().toBuffer(),
      left: 40,
      top: 60,
    }])
    .png()
    .toBuffer();
  const rawMirror = await generatePassengerMirror(driver);
  const calls = [];
  await assert.rejects(() => producePassengerView({
    driverBytes: driver,
    prompt: "Acme company logo",
    call: { sourceViewType: "passenger-side", attempt: 1 },
    provider: {
      generateImage: async (call) => {
        calls.push(call);
        return {
          bytes: driver,
          contentType: "image/png",
          model: "gemini-3-pro-image",
          keyFingerprint: "0123456789ab",
          attempts: [],
        };
      },
    },
  }), (error) => error.code === "designpanel_passenger_text_repair_required");

  assert.equal(calls.length, 2);
  assert.equal(calls[0].parts[0].inlineData.mimeType, "image/jpeg");
  assert.equal(calls[0].parts.some((part) => part.inlineData?.mimeType === "image/png"), false,
    "the ordinary driver reference leaked into the passenger text edit");
});

test("passenger text-repair failure never publishes the raw mirror", async () => {
  const driver = await sharp({ create: { width: 640, height: 360, channels: 3, background: "#1565c0" } }).png().toBuffer();
  let calls = 0;
  await assert.rejects(() => producePassengerView({
    driverBytes: driver,
    prompt: "Flamingo Pools",
    call: { sourceViewType: "passenger-side", attempt: 1 },
    provider: { generateImage: async () => { calls += 1; throw new Error("text edit timed out"); } },
  }), (error) => error.code === "designpanel_passenger_text_repair_required"
    && /two|attempt 2/i.test(error.message));
  assert.equal(calls, 2);
});

test("passenger accepts repaired bytes only for explicit opposite-facing orientation with matching pixels and framing", async () => {
  const driver = await asymmetricDriverFixture();
  const rawMirror = await generatePassengerMirror(driver);
  const result = await producePassengerView({
    driverBytes: driver,
    prompt: "Acme company logo",
    call: { sourceViewType: "passenger-side", attempt: 1 },
    provider: textRepairProvider(rawMirror),
  });

  assert.equal(result.model, "gemini-text-repair");
  assert.deepEqual(result.bytes, rawMirror);
  assert.equal(result.metadata.textRepair, "accepted-opposite-facing");
  assert.equal(result.metadata.framingVerified, true);
  assert.deepEqual(result.metadata.pixelDimensions, { width: 640, height: 360 });
  assert.equal(result.metadata.framingMae, 0);
});

test("passenger fails closed when orientation is ambiguous", async () => {
  const driver = await sharp({ create: { width: 640, height: 360, channels: 3, background: "#1565c0" } }).png().toBuffer();
  const rawMirror = await generatePassengerMirror(driver);
  await assert.rejects(() => producePassengerView({
    driverBytes: driver,
    prompt: "Acme company logo",
    call: { sourceViewType: "passenger-side", attempt: 1 },
    provider: textRepairProvider(rawMirror),
  }), (error) => error.code === "designpanel_passenger_text_repair_required");
});

test("passenger fails closed when repaired bytes cannot be orientation-verified", async () => {
  const driver = await asymmetricDriverFixture();
  const rawMirror = await generatePassengerMirror(driver);
  await assert.rejects(() => producePassengerView({
    driverBytes: driver,
    prompt: "Acme company logo",
    call: { sourceViewType: "passenger-side", attempt: 1 },
    provider: textRepairProvider(Buffer.from("not-an-image")),
  }), (error) => error.code === "designpanel_passenger_text_repair_required");
});

test("passenger rejects opposite-facing repaired bytes when pixel dimensions changed", async () => {
  const driver = await asymmetricDriverFixture();
  const rawMirror = await generatePassengerMirror(driver);
  const resized = await sharp(rawMirror).resize(320, 180, { fit: "fill" }).jpeg({ quality: 92 }).toBuffer();
  const framing = await passengerFramingVerdict(rawMirror, resized);
  assert.equal(framing.matches, false);
  assert.equal(framing.reason, "pixel-dimensions-mismatch");

  await assert.rejects(() => producePassengerView({
    driverBytes: driver,
    prompt: "Acme company logo",
    call: { sourceViewType: "passenger-side", attempt: 1 },
    provider: textRepairProvider(resized),
  }), (error) => error.code === "designpanel_passenger_text_repair_required");
});

test("passenger rejects opposite-facing repaired bytes when framing changed at the same dimensions", async () => {
  const driver = await asymmetricDriverFixture();
  const rawMirror = await generatePassengerMirror(driver);
  const inset = await sharp(rawMirror).resize(384, 216, { fit: "fill" }).jpeg({ quality: 92 }).toBuffer();
  const reframed = await sharp({ create: { width: 640, height: 360, channels: 3, background: "#000000" } })
    .composite([{ input: inset, left: 128, top: 72 }])
    .jpeg({ quality: 92 })
    .toBuffer();
  const framing = await passengerFramingVerdict(rawMirror, reframed);
  assert.equal(framing.matches, false);
  assert.equal(framing.reason, "framing-mismatch");

  await assert.rejects(() => producePassengerView({
    driverBytes: driver,
    prompt: "Acme company logo",
    call: { sourceViewType: "passenger-side", attempt: 1 },
    provider: textRepairProvider(reframed),
  }), (error) => error.code === "designpanel_passenger_text_repair_required");
});
