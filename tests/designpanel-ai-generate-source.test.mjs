import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the standalone creative engine identifies design-panel-ai-generate as its source", () => {
  const edge = read("supabase/functions/design-panel-ai-generate/index.ts");
  const prompt = read("runtime/designiq-prompt.cjs");
  const atlas = read("runtime/flat-first-atlas.cjs");
  const worker = read("runtime/generation-worker.cjs");

  assert.match(edge, /\* design-panel-ai-generate/);
  assert.match(prompt, /supabase\/functions\/design-panel-ai-generate\/index\.ts/);
  assert.match(atlas, /buildFlatDesignIQDirection/);
  assert.match(worker, /buildDesignIQPrompt/);
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
