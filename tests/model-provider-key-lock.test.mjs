/**
 * LOCK 2 — MODEL / PROVIDER / KEY. SEPARATE FROM THE FUNCTION/SOURCE LOCK.
 *
 * Owner, 2026-08-28: "Do not combine source-code identity, model selection, and
 * API-key availability into one 'lock.' They are different contracts and must
 * fail independently... Do not report a function-lock failure when the problem
 * is a provider key. Do not report a key/model failure when the wrong function
 * body is deployed."
 *
 * LOCK 1 lives in `proof-stack-pinned-sources.test.mjs` and proves WHICH CODE
 * runs. This file proves WHAT PROVIDER CONFIGURATION that code is allowed to
 * use, and it must never assert a source hash — rotating a credential may not
 * invalidate the function lock, and editing a prompt may not invalidate this
 * one.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = resolve(new URL("..", import.meta.url).pathname);
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

test("provider, model and key selection are three separate things", () => {
  const modelConfig = read("supabase/functions/_shared/model-config.ts");
  // The approved image model is EXPLICITLY selected, by name, not read from an
  // environment variable at the point of use.
  assert.match(modelConfig, /export const PRIMARY_IMAGE_MODEL = "[^"]+"/);
  // Fallback is explicit, not implicit-on-error.
  assert.match(modelConfig, /export const FALLBACK_IMAGE_MODEL = "[^"]+"/);
  // Key selection is transport infrastructure and lives on its own.
  const keyPool = read("supabase/functions/_shared/gemini-key-pool.ts");
  assert.match(keyPool, /export function getGeminiKey/);
  assert.match(keyPool, /export function hasGeminiKey/);
  // ...and the key pool decides keys only. It must not decide models.
  assert.ok(!/PRIMARY_IMAGE_MODEL|FALLBACK_IMAGE_MODEL/.test(keyPool),
    "the key pool selects a model — key rotation would then change the model");
});

/**
 * ⚠️ THE AUTHORING MODEL AND THE PROOF MODEL ARE DIFFERENT IDS TODAY, AND THAT
 * IS A MODEL/CONFIG QUESTION, NOT A FUNCTION QUESTION.
 *
 * Call 1 authors on the GA id, pinned BY NAME in the runtime because
 * `lockModel` alone pins "the first of whatever is configured", which is config
 * drift rather than a pin. CLAUDE.md records the measurement behind that
 * choice: eleven production masters on the GA id held a full-bleed border
 * across every prompt version, and the first `-preview` run dropped it to
 * 18–23 with 63–83% of each border dark.
 *
 * The proof stack takes its model from `model-config.ts`, which is currently
 * on the `-preview` id. This test does not force them equal — the proofs are
 * projections and CLAUDE.md deliberately allows them a fallback the authoring
 * call is denied. It exists so the difference is STATED and has to be
 * re-approved rather than drifting silently.
 */
test("the authoring model is pinned by name and is not an env lookup", () => {
  const prompt = read("runtime/designiq-prompt.cjs");
  assert.match(prompt, /const DESIGNPANEL_AUTHORING_MODEL = "[^"]+"/);
  const line = prompt.match(/const DESIGNPANEL_AUTHORING_MODEL = "([^"]+)"/)[1];
  assert.ok(!/process\.env/.test(
    prompt.slice(prompt.indexOf("DESIGNPANEL_AUTHORING_MODEL"), prompt.indexOf("DESIGNPANEL_AUTHORING_MODEL") + 200),
  ), "the authoring model became an env lookup — that is config drift, not a pin");
  // Recorded so a change to either id is a visible diff in this file.
  assert.equal(line, "gemini-3-pro-image");
  const modelConfig = read("supabase/functions/_shared/model-config.ts");
  assert.equal(modelConfig.match(/PRIMARY_IMAGE_MODEL = "([^"]+)"/)[1], "gemini-3-pro-image-preview");
});

/**
 * NEVER RECORD THE KEY. Owner: "never store actual secret key material in
 * provenance, tests, hashes, migrations, or metadata. Record only non-secret
 * runtime provenance such as provider, model, functionName,
 * functionVersion/sourceCommit, requestId."
 */
test("no secret key material is recorded anywhere in provenance", () => {
  const { execFileSync } = require("node:child_process");
  // A Google API key is `AIza` + 35 chars. Nothing in the repository may carry
  // a literal one, in any file type.
  let literal = "";
  try {
    literal = execFileSync("git", ["grep", "-nE", "AIza[0-9A-Za-z_-]{30,}", "--", ":!node_modules"],
      { cwd: ROOT, encoding: "utf8" });
  } catch { literal = ""; }
  assert.equal(literal.trim(), "", "a literal Google API key is committed to the repository");

  // And the proof/authoring paths must not WRITE key material into metadata.
  for (const rel of [
    "runtime/designpanel-server-provider.cjs",
    "runtime/flat-first-atlas.cjs",
    "supabase/functions/persona-photographer-render/index.ts",
    "supabase/functions/design-panel-ai-generate/index.ts",
  ]) {
    const source = read(rel);
    for (const forbidden of ["apiKey:", "geminiKey:", "GOOGLE_AI_API_KEY:", "keyValue:"]) {
      assert.ok(!source.includes(forbidden), `${rel} records key material as ${forbidden}`);
    }
  }
});

test("the proof records the non-secret provenance the owner listed", () => {
  const photographer = read("supabase/functions/persona-photographer-render/index.ts");
  const atlas = photographer.slice(photographer.indexOf("async function handleAtlasProof"));
  for (const field of ["provider:", "model:", "functionName:", "functionVersion:", "requestId,"]) {
    assert.ok(atlas.includes(field), `the atlas-proof response omits ${field}`);
  }
  // `keyFingerprint` is a non-reversible identifier and is fine; the KEY is not.
  assert.ok(!/getGeminiKey\(\)[^)]*\)\s*,?\s*(model|provider|requestId)/.test(atlas));
});

/**
 * A DEAD KEY IS NOT A SOURCE CHANGE. The photographer resolves its key at call
 * time from the pool, so rotating a credential changes nothing this file or
 * LOCK 1 asserts.
 */
test("key selection happens at call time, so rotation cannot invalidate LOCK 1", () => {
  const photographer = read("supabase/functions/persona-photographer-render/index.ts");
  const atlas = photographer.slice(photographer.indexOf("async function handleAtlasProof"));
  assert.match(atlas, /geminiImageUrl\(getGeminiKey\(\), currentModel\)/,
    "the key must be resolved per request from the pool, never captured once");
  const lock1 = read("tests/proof-stack-pinned-sources.test.mjs");
  assert.ok(!/AIza|GOOGLE_AI_API_KEY|getGeminiKey\(\)/.test(lock1),
    "LOCK 1 depends on key material — a credential rotation would fail the source lock");
});
