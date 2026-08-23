import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  EDGE_PROVIDER_CONTRACT,
  LOCKED_MODEL,
  createDesignPanelEdgeProvider,
} = require("../runtime/designpanel-edge-provider.cjs");

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const GENERATION_ID = "33333333-3333-4333-8333-333333333333";
const TENANT_KEY = `user_${OWNER_ID}`;
const PROJECT_URL = "https://designpro-production.supabase.co";
const SERVICE_KEY = `sb_secret_${"x".repeat(48)}`;

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("Standard server orchestration invokes the sanctioned designer then photographer Edge Functions", async () => {
  const heroBytes = Buffer.alloc(80_000, 0x31);
  const passengerBytes = Buffer.alloc(90_000, 0x42);
  const heroHash = hash(heroBytes);
  const acceptedHeroPath = `designpro/${TENANT_KEY}/${GENERATION_ID}/calls-1-7/side/${heroHash}.png`;
  const designerPath = `renders/${OWNER_ID}/DesignPanelPro/ai-generated/hero.png`;
  const photographerPath = `renders/${OWNER_ID}/designpanelpro/passenger.png`;
  let heroReady = false;
  const calls = [];

  const storage = {
    createSignedUrl: async (storagePath) => ({
      data: { signedUrl: `${PROJECT_URL}/storage/v1/object/sign/wrap-files/${storagePath}?token=test` },
      error: null,
    }),
    download: async (storagePath) => {
      if (storagePath === designerPath || storagePath === acceptedHeroPath) {
        return { data: new Blob([heroBytes]), error: null };
      }
      if (storagePath === photographerPath) {
        return { data: new Blob([passengerBytes]), error: null };
      }
      return { data: null, error: { message: `unexpected ${storagePath}` } };
    },
  };
  const heroRow = {
    storage_path: acceptedHeroPath,
    content_hash: heroHash,
    byte_size: heroBytes.length,
    content_type: "image/png",
    metadata: { designAnchorText: "locked hero design anchor" },
  };
  const supabase = {
    auth: {
      admin: {
        getUserById: async (userId) => ({
          data: { user: { id: userId, email: "owner@example.com" } },
          error: null,
        }),
      },
    },
    storage: { from: (bucket) => {
      assert.equal(bucket, "wrap-files");
      return storage;
    } },
    from: (table) => {
      assert.equal(table, "designpro_generation_views");
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        maybeSingle: async () => ({ data: heroReady ? heroRow : null, error: null }),
      };
      return chain;
    },
  };
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    if (url.endsWith("/design-panel-ai-generate")) {
      return jsonResponse({
        success: true,
        renderUrl: `${PROJECT_URL}/storage/v1/object/public/wrap-files/${designerPath}`,
        storagePath: designerPath,
        contentType: "image/png",
        designAnchorText: "locked hero design anchor",
      });
    }
    if (url.endsWith("/generate-color-render")) {
      return jsonResponse({
        renderUrl: `${PROJECT_URL}/storage/v1/object/public/wrap-files/${photographerPath}`,
        storagePath: photographerPath,
        contentType: "image/png",
        sourceFunction: "generate-color-render",
      });
    }
    return jsonResponse({ error: "wrong_function" }, 404);
  };

  const provider = createDesignPanelEdgeProvider({
    supabase,
    provider: {},
    fetchImpl,
    supabaseUrl: PROJECT_URL,
    serviceRoleKey: SERVICE_KEY,
    requestId: REQUEST_ID,
    generationId: GENERATION_ID,
    tenantKey: TENANT_KEY,
    input: {
      brief: "Photographic pool scene with premium custom branding",
      mode: "commercial",
      companyName: "Flamingo Pools",
      phone: "602-555-1212",
      industry: "pool service",
      colors: ["teal", "coral"],
      finish: "Gloss",
      visionboardIntent: "style_inspiration",
      logoAsset: { storagePath: `designpro/${TENANT_KEY}/sources/logo.png` },
      visionBoardImages: [{ storagePath: `designpro/${TENANT_KEY}/sources/pool.jpg` }],
      vehicle: { year: "2024", make: "Ford", model: "F-250", type: "truck" },
    },
  });

  const driver = await provider.generateImage({
    sourceViewType: "side",
    parts: [{ text: "must not become a local Gemini request" }],
    imageSize: "4K",
  });
  assert.equal(provider.contract, EDGE_PROVIDER_CONTRACT);
  assert.deepEqual(provider.models, [LOCKED_MODEL]);
  assert.deepEqual(driver.bytes, heroBytes);
  assert.equal(driver.metadata.stage, "design-panel-ai-generate");
  assert.equal(driver.metadata.sourceFunction, "design-panel-ai-generate");
  assert.equal(driver.metadata.execution, "supabase-edge-function");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${PROJECT_URL}/functions/v1/design-panel-ai-generate`);
  assert.equal(calls[0].options.headers.apikey, SERVICE_KEY);
  assert.equal(calls[0].options.headers["x-designpro-owner-id"], OWNER_ID);
  assert.equal(calls[0].options.headers["x-designpro-mode"], undefined);
  assert.equal(calls[0].body.mode, "commercial");
  assert.equal(calls[0].body.prompt, "Photographic pool scene with premium custom branding");
  assert.equal(calls[0].body.companyName, "Flamingo Pools");
  assert.equal(calls[0].body.vehicleModel, "F-250");
  assert.equal(calls[0].body.forceNew, true);
  assert.equal(calls[0].body.visionBoardImages[0].slotLabel, "Customer logo");
  assert.match(calls[0].body.visionBoardImages[0].storageUrl, /logo\.png\?token=test$/);
  assert.equal(calls[0].body.visionBoardImages[1].slotLabel, "VisionBoard 1");

  // The generation engine persists Driver between the two stages.
  heroReady = true;
  const passenger = await provider.generateImage({
    sourceViewType: "passenger-side",
    parts: [{ text: "must not become a local Gemini request" }],
    imageSize: "4K",
  });
  assert.deepEqual(passenger.bytes, passengerBytes);
  assert.equal(passenger.metadata.stage, "generate-color-render");
  assert.equal(passenger.metadata.sourceFunction, "generate-color-render");
  assert.equal(passenger.metadata.execution, "supabase-edge-function");
  assert.equal(passenger.metadata.heroContentHash, heroHash);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, `${PROJECT_URL}/functions/v1/generate-color-render`);
  assert.equal(calls[1].options.headers["x-designpro-mode"], "designpanelpro");
  assert.equal(calls[1].body.modeType, "designpanelpro");
  assert.equal(calls[1].body.userEmail, "owner@example.com");
  assert.equal(calls[1].body.viewType, "passenger-side");
  assert.equal(calls[1].body.skipLookups, true);
  assert.equal(calls[1].body.skipCacheStorage, true);
  assert.equal(calls[1].body.skipCache, true);
  assert.equal(calls[1].body.forceNew, true);
  assert.equal(calls[1].body.colorData.designAnchorText, "locked hero design anchor");
  assert.equal(
    calls[1].body.colorData.heroReferenceUrl,
    `${PROJECT_URL}/storage/v1/object/sign/wrap-files/${acceptedHeroPath}?token=test`,
  );
});

test("the Standard Edge adapter rejects a response object outside the authenticated owner", async () => {
  const supabase = {
    auth: { admin: { getUserById: async () => ({ data: { user: { email: "owner@example.com" } }, error: null }) } },
    storage: {
      from: () => ({
        createSignedUrl: async () => ({
          data: { signedUrl: `${PROJECT_URL}/storage/v1/object/sign/wrap-files/source.png?token=test` },
          error: null,
        }),
        download: async () => ({ data: new Blob([Buffer.alloc(80_000)]), error: null }),
      }),
    },
    from: () => { throw new Error("hero lookup is not expected"); },
  };
  const provider = createDesignPanelEdgeProvider({
    supabase,
    provider: {},
    fetchImpl: async () => jsonResponse({
      success: true,
      renderUrl: `${PROJECT_URL}/storage/v1/object/public/wrap-files/renders/another-user/hero.png`,
      storagePath: "renders/another-user/DesignPanelPro/ai-generated/hero.png",
      contentType: "image/png",
    }),
    supabaseUrl: PROJECT_URL,
    serviceRoleKey: SERVICE_KEY,
    requestId: REQUEST_ID,
    generationId: GENERATION_ID,
    tenantKey: TENANT_KEY,
    input: { brief: "test", vehicle: { year: "2024", make: "Ford", model: "F-250" } },
  });
  await assert.rejects(
    () => provider.generateImage({ sourceViewType: "side" }),
    (error) => error?.code === "designpanel_edge_result_identity_invalid" && error.retryable === false,
  );
});
