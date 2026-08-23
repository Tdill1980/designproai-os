import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the Standard standalone worker routes through the sanctioned Edge producers", () => {
  const edge = read("supabase/functions/design-panel-ai-generate/index.ts");
  const prompt = read("runtime/designiq-prompt.cjs");
  const atlas = read("runtime/flat-first-atlas.cjs");
  const worker = read("runtime/generation-worker.cjs");
  const provider = read("runtime/designpanel-server-provider.cjs");
  const edgeProvider = read("runtime/designpanel-edge-provider.cjs");
  const productionDeploy = read(".github/workflows/deploy-production.yml");

  assert.match(edge, /\* design-panel-ai-generate/);
  assert.match(prompt, /supabase\/functions\/design-panel-ai-generate\/index\.ts/);
  assert.match(atlas, /buildAtlasArtboardDesignIQDirection/);
  assert.match(
    prompt,
    /function buildFlatDesignIQDirection[\s\S]*?return buildAtlasArtboardDesignIQDirection\(input\)/,
    "the historical flat prompt API remains a compatibility alias",
  );
  assert.match(worker, /buildDesignIQPrompt/);
  assert.match(worker, /createDesignPanelEdgeProvider/);
  assert.match(edgeProvider, /functions\/v1\/\$\{functionName\}/);
  assert.match(edgeProvider, /invoke\("design-panel-ai-generate"/);
  assert.match(edgeProvider, /invoke\("generate-color-render"/);
  assert.match(edgeProvider, /execution: "supabase-edge-function"/);
  assert.match(edgeProvider, /x-designpro-owner-id/);
  assert.match(edgeProvider, /x-designpro-mode/);
  assert.doesNotMatch(edgeProvider, /qualityProvider\?\.generateImage/);
  assert.match(provider, /stage: "design-panel-ai-generate"/);
  assert.match(provider, /stage: "generate-color-render"/);
  assert.match(provider, /execution: "server-native"/);
  assert.match(provider, /resize\(1024, 1024/);
  assert.match(provider, /View 1 bytes do not match the immutable database identity/);
  assert.doesNotMatch(provider, /\/functions\/v1|supabase\.functions|createSignedUrl/);
  assert.doesNotMatch(productionDeploy, /repair-designpanel-edge-chain/);
  assert.doesNotMatch(productionDeploy, /functions deploy generate-color-render/);
  assert.match(provider, /maxProviderAttempts:\s*4/);
  assert.match(worker, /slots:\s*slots\.slice\(0, 1\)/);
  assert.match(
    worker,
    /slots:\s*slots\.slice\(1\)[\s\S]*?parallel:\s*false/,
    "Views 2-7 must be serialized against the one frozen View 1 anchor",
  );
  assert.doesNotMatch(worker, /authorCreativeInput/);
});

test("the sanctioned Edge implementation is reachable only through the server release", () => {
  const auth = read("supabase/functions/_shared/designpro-internal-call.ts");
  const designer = read("supabase/functions/design-panel-ai-generate/index.ts");
  const router = read("supabase/functions/generate-color-render/index.ts");
  const photographer = read("supabase/functions/generate-color-render/designpanel-handler.ts");
  const legacy = read("supabase/functions/generate-color-render/legacy.ts");
  const releaseFiles = read("ops/release-files.txt");
  const worker = read("runtime/generation-worker.cjs");

  assert.match(auth, /req\.headers\.get\("apikey"\)/);
  assert.match(auth, /createClient\([\s\S]*?serverKey/);
  assert.match(auth, /auth\.admin\.getUserById\(ownerHeader\)/);
  assert.doesNotMatch(auth, /SUPABASE_SERVICE_ROLE_KEY|bearer !==/);
  assert.match(designer, /skip:\s*internalCaller\.internal/);
  assert.match(router, /req\.headers\.get\("x-designpro-mode"\) === "designpanelpro"/);
  assert.doesNotMatch(router, /req\.clone\(\)|\.json\(\)/);
  assert.match(router, /import\("\.\/designpanel-handler\.ts"\)/);
  assert.match(router, /import\("\.\/legacy\.ts"\)/);
  assert.match(photographer, /resolveDesignProInternalCaller\(req\)/);
  assert.match(photographer, /!caller\.internal/);
  assert.match(photographer, /body\.modeType !== "designpanelpro"/);
  assert.doesNotMatch(
    photographer,
    /tokenGate|vehicle-specs-lookup|graphicspro-prompt-builder/,
  );
  assert.match(photographer, /sourceFunction:\s*"generate-color-render"/);
  assert.match(photographer, /label:\s*"pattern-primary"/);
  assert.match(photographer, /label:\s*"hero-reference"/);
  assert.match(photographer, /safeSegment\(viewType\)\}\.png/);
  assert.match(photographer, /contentType:\s*"image\/png"/);
  assert.doesNotMatch(`${router}\n${photographer}`, /design-panel-color-render/);
  assert.match(releaseFiles, /designpanel-edge-provider\.cjs/);
  assert.match(worker, /designpanel-edge-provider|createDesignPanelEdgeProvider/);
  assert.equal(
    createHash("sha256").update(legacy).digest("hex"),
    "46022e2f487e785256e76d6b3ee1c68b35f127138ea2b1117f687e9bba0fec47",
    "ColorPro, GraphicsPro, FadeWraps, ApproveMode, and other legacy modes must remain byte-identical",
  );
  assert.equal(
    existsSync(new URL("../supabase/functions/design-panel-color-render", import.meta.url)),
    false,
    "a second DesignPanel producer directory must never exist",
  );
  assert.match(designer, /storagePath:\s*fileName/);
  assert.match(photographer, /const storagePath =/);
});

test("A.T.L.A.S. never reintroduces the legacy browser Edge invocation or token gate", () => {
  const customerHook = read("app/src/hooks/useDesignPanelProLogic.ts");
  const atlas = read("runtime/flat-first-atlas.cjs");
  const worker = read("runtime/generation-worker.cjs");
  const reachable = `${customerHook}\n${atlas}\n${worker}`;

  assert.doesNotMatch(customerHook, /functions\.invoke\(["']design-panel-ai-generate["']/);
  assert.doesNotMatch(atlas, /tokenGate|designiq_generations|user_tokens/);
  assert.doesNotMatch(worker, /tokenGate|designiq_generations|user_tokens/);
  assert.match(reachable, /flat-first-atlas-v1|flatFirstRequested/);
});
