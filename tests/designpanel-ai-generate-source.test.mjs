import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the standalone creative engine identifies design-panel-ai-generate as its source", () => {
  const edge = read("supabase/functions/design-panel-ai-generate/index.ts");
  const prompt = read("runtime/designiq-prompt.cjs");
  const atlas = read("runtime/flat-first-atlas.cjs");
  const worker = read("runtime/generation-worker.cjs");
  const provider = read("runtime/designpanel-edge-provider.cjs");
  const edgeDeploy = read(".github/workflows/deploy-edge-functions.yml");
  const productionDeploy = read(".github/workflows/deploy-production.yml");

  assert.match(edge, /\* design-panel-ai-generate/);
  assert.match(prompt, /supabase\/functions\/design-panel-ai-generate\/index\.ts/);
  assert.match(atlas, /buildFlatDesignIQDirection/);
  assert.match(worker, /buildDesignIQPrompt/);
  assert.match(worker, /createDesignPanelEdgeProvider/);
  assert.match(provider, /invoke\("design-panel-ai-generate"/);
  assert.match(provider, /invoke\("generate-color-render"/);
  assert.doesNotMatch(provider, /design-panel-color-render/);
  assert.doesNotMatch(provider, /width:\s*1024|resize:\s*"contain"/);
  assert.match(edgeDeploy, /functions delete design-panel-color-render/);
  assert.match(productionDeploy, /\[repair-designpanel-edge-chain\]/);
  assert.match(productionDeploy, /functions deploy generate-color-render/);
  assert.match(productionDeploy, /functions delete design-panel-color-render/);
  assert.ok(
    productionDeploy.lastIndexOf("ci-dark-deploy.sh") <
      productionDeploy.indexOf("Restore the sanctioned DesignPanel Edge chain"),
    "the corrected runtime must be live before the forbidden Edge slug is deleted",
  );
  assert.match(provider, /maxProviderAttempts:\s*1/);
  assert.match(worker, /slots:\s*slots\.slice\(0, 1\)/);
  assert.match(
    worker,
    /slots:\s*slots\.slice\(1\)[\s\S]*?parallel:\s*false/,
    "Views 2-7 must be serialized so the heavy photographer function stays within Edge compute capacity",
  );
  assert.doesNotMatch(worker, /authorCreativeInput/);
});

test("the sanctioned DesignPanel Edge functions accept only a service-authenticated standalone owner", () => {
  const auth = read("supabase/functions/_shared/designpro-internal-call.ts");
  const designer = read("supabase/functions/design-panel-ai-generate/index.ts");
  const router = read("supabase/functions/generate-color-render/index.ts");
  const photographer = read("supabase/functions/generate-color-render/designpanel-handler.ts");
  const legacy = read("supabase/functions/generate-color-render/legacy.ts");

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
