import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  EDGE_PROVIDER_CONTRACT,
  createDesignPanelEdgeProvider,
} = require("../runtime/designpanel-edge-provider.cjs");

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const SERVICE_KEY = "service-role-key-that-never-leaves-the-runtime";

function mockSupabase() {
  const bytesByPath = new Map([
    [`renders/${OWNER_ID}/DesignPanelPro/ai-generated/hero.png`, Buffer.from("hero-bytes")],
    [`renders/${OWNER_ID}/designpanelpro/passenger.png`, Buffer.from("passenger-bytes")],
  ]);
  return {
    auth: { admin: { getUserById: async (id) => ({
      data: { user: { id, email: "owner@example.com" } }, error: null,
    }) } },
    storage: {
      from: () => ({
        createSignedUrl: async (path) => ({ data: { signedUrl: `https://signed.invalid/${path}` }, error: null }),
        download: async (path) => ({ data: new Blob([bytesByPath.get(path) || Buffer.from("asset")], { type: "image/png" }), error: null }),
      }),
    },
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return chain;
    },
  };
}

test("standard DesignPanel generation calls the restored designer, then the photographer", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, headers: init.headers });
    if (url.endsWith("/design-panel-ai-generate")) {
      return new Response(JSON.stringify({
        storagePath: `renders/${OWNER_ID}/DesignPanelPro/ai-generated/hero.png`,
        contentType: "image/png",
        designAnchorText: "blue wave, exact white lettering",
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      storagePath: `renders/${OWNER_ID}/designpanelpro/passenger.png`,
      contentType: "image/png",
    }), { status: 200 });
  };

  const provider = createDesignPanelEdgeProvider({
    supabase: mockSupabase(),
    supabaseUrl: "https://example.supabase.co",
    serviceRoleKey: SERVICE_KEY,
    ownerId: OWNER_ID,
    requestId: REQUEST_ID,
    fetchImpl,
    input: {
      brief: "Deep blue pool-water wrap",
      designName: "Flamingo Pools",
      mode: "commercial",
      companyName: "Flamingo Pools",
      phone: "602-555-0100",
      website: "flamingopools.example",
      finish: "Gloss",
      vehicle: { year: "2024", make: "Ford", model: "F-250" },
    },
  });

  const hero = await provider.generateImage({ sourceViewType: "side", timeoutMs: 1000 });
  const passenger = await provider.generateImage({ sourceViewType: "passenger-side", imageSize: "4K", timeoutMs: 1000 });

  assert.equal(provider.contract, EDGE_PROVIDER_CONTRACT);
  assert.equal(provider.maxProviderAttempts, 1, "the runtime must not multiply the Edge function's own retry ladder");
  assert.equal(hero.bytes.toString(), "hero-bytes");
  assert.equal(hero.metadata.sourceFunction, "design-panel-ai-generate");
  assert.equal(passenger.bytes.toString(), "passenger-bytes");
  assert.equal(passenger.metadata.sourceFunction, "generate-color-render");
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/design-panel-ai-generate$/);
  assert.equal(calls[0].body.viewType, "side");
  assert.equal(calls[0].body.phone, "602-555-0100 | flamingopools.example");
  assert.match(calls[1].url, /\/generate-color-render$/);
  assert.equal(calls[1].body.viewType, "passenger-side");
  assert.equal(calls[1].body.modeType, "designpanelpro");
  assert.equal(calls[1].headers["x-designpro-mode"], "designpanelpro");
  assert.equal(calls[1].body.colorData.designAnchorText, "blue wave, exact white lettering");
  assert.match(calls[1].body.colorData.heroReferenceUrl, /^https:\/\/signed\.invalid\//);
  assert.equal(calls[0].headers.apikey, SERVICE_KEY);
  assert.equal("x-designpro-mode" in calls[0].headers, false);
  assert.equal("authorization" in calls[0].headers, false);
  assert.equal(calls[0].headers["x-designpro-owner-id"], OWNER_ID);
});

test("the provider rejects an Edge output outside the authenticated owner's storage prefix", async () => {
  const provider = createDesignPanelEdgeProvider({
    supabase: mockSupabase(),
    supabaseUrl: "https://example.supabase.co",
    serviceRoleKey: SERVICE_KEY,
    ownerId: OWNER_ID,
    requestId: REQUEST_ID,
    input: { brief: "test", vehicle: { year: "2024", make: "Ford", model: "F-250" } },
    fetchImpl: async () => new Response(JSON.stringify({
      storagePath: "renders/someone-else/stolen.png",
      contentType: "image/png",
    }), { status: 200 }),
  });

  await assert.rejects(
    provider.generateImage({ sourceViewType: "side", timeoutMs: 1000 }),
    (error) => error?.code === "designpanel_edge_storage_identity_invalid" && error.retryable === false,
  );
});
