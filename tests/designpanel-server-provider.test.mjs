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
} = require("../runtime/designpanel-server-provider.cjs");

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const GENERATION_ID = "33333333-3333-4333-8333-333333333333";
const TENANT_KEY = `user_${OWNER_ID}`;

async function fixture(overrides = {}) {
  const heroBytes = await sharp({ create: { width: 1600, height: 900, channels: 3, background: "#1565c0" } }).png().toBuffer();
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
  assert.equal(calls.length, 2);
  assert.equal(calls[0].parts[0].text, "server A.C.E. DesignIQ prompt");
  assert.equal(calls[1].temperature, 1);
  assert.equal(calls[1].responseModalities.join(","), "TEXT,IMAGE");
  assert.equal(calls[1].parts.length, 3);
  assert.match(calls[1].parts[0].text, /^\[GENERATE IMAGE\]/);
  assert.match(calls[1].parts[0].text, /same wrap design/i);
  assert.match(calls[1].parts[0].text, /passenger side/);
  assert.equal(calls[1].parts[1].inlineData.data, calls[1].parts[2].inlineData.data);
  assert.equal(calls[1].parts[1].inlineData.mimeType, "image/png");
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
