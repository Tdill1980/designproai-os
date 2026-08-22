import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

const require = createRequire(import.meta.url);
const provider = require("../../runtime/generation-provider.cjs");
test("GENIE grounding uses the server generation-provider endpoint and key seam", () => {
  const resolver = readFileSync(new URL("../../runtime/genie-universal-resolver.cjs", import.meta.url), "utf8");
  assert.doesNotMatch(resolver, /generativelanguage\.googleapis\.com/);
  assert.doesNotMatch(resolver, /process\.env\.(?:GOOGLE_AI_API_KEY_POOL|GOOGLE_AI_API_KEY|GEMINI_API_KEY)/);
  assert.match(resolver, /\.generateRaw\(/);

  const endpoint = provider.endpointFor("gemini-test-model", "server-secret");
  assert.match(endpoint.url, /gemini-test-model/);
  assert.match(endpoint.url, /server-secret/);
  assert.equal(endpoint.headers["content-type"], "application/json");
});

test("raw grounding transport rotates through the server key pool on HTTP failure", async () => {
  const seen = [];
  const pool = provider.createProvider({
    keys: ["key-a", "key-b"],
    models: ["gemini-3-pro-image"],
    fetchImpl: async (url) => {
      const key = new URL(url).searchParams.get("key");
      seen.push(key);
      if (key === "key-a") return new Response("busy", { status: 429 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const result = await pool.generateRaw({
    model: "gemini-2.5-flash",
    body: { contents: [{ parts: [{ text: "ground this" }] }] },
    label: "GENIE grounding",
  });
  assert.deepEqual(seen, ["key-a", "key-b"]);
  assert.equal(result.payload.candidates.length, 1);
  assert.equal(result.attempts.length, 1);
});
