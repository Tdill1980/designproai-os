import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the standalone creative engine identifies design-panel-ai-generate as its source", () => {
  const edge = read("supabase/functions/design-panel-ai-generate/index.ts");
  const prompt = read("runtime/designiq-prompt.cjs");
  const atlas = read("runtime/flat-first-atlas.cjs");
  const worker = read("runtime/generation-worker.cjs");
  const provider = read("runtime/designpanel-edge-provider.cjs");

  assert.match(edge, /\* design-panel-ai-generate/);
  assert.match(prompt, /supabase\/functions\/design-panel-ai-generate\/index\.ts/);
  assert.match(atlas, /buildFlatDesignIQDirection/);
  assert.match(worker, /buildDesignIQPrompt/);
  assert.match(worker, /createDesignPanelEdgeProvider/);
  assert.match(provider, /invoke\("design-panel-ai-generate"/);
  assert.match(provider, /invoke\("generate-color-render"/);
  assert.match(provider, /maxProviderAttempts:\s*1/);
  assert.match(worker, /slots:\s*slots\.slice\(0, 1\)/);
  assert.match(worker, /slots:\s*slots\.slice\(1\)[\s\S]*?parallel:\s*true/);
  assert.doesNotMatch(worker, /authorCreativeInput/);
});

test("the two restored Edge functions accept only a service-authenticated standalone owner", () => {
  const auth = read("supabase/functions/_shared/designpro-internal-call.ts");
  const designer = read("supabase/functions/design-panel-ai-generate/index.ts");
  const photographer = read("supabase/functions/generate-color-render/index.ts");

  assert.match(auth, /bearer !== serviceRole/);
  assert.match(auth, /auth\.admin\.getUserById\(ownerHeader\)/);
  assert.match(designer, /skip:\s*internalCaller\.internal/);
  assert.match(photographer, /skip:\s*internalCaller\.internal/);
  assert.match(designer, /storagePath:\s*fileName/);
  assert.match(photographer, /storagePath:\s*fileName/);
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
