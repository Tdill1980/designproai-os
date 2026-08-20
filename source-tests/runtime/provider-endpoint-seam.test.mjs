import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { strict as assert } from "node:assert";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const runtimeDir = join(root, "runtime");
const SEAM = "generation-provider.cjs";

/**
 * Moving this runtime to Vertex AI changes the host, the path shape and the
 * credential together. Three call sites had each built their own endpoint and
 * read the key straight out of process.env, which put them outside the key
 * pool's rotation and made the provider move a five-file edit that would have
 * been done in four. The seam is only worth anything while it is the only one.
 */
test("only generation-provider states where a model lives", () => {
  const offenders = readdirSync(runtimeDir)
    .filter((name) => name.endsWith(".cjs") && name !== SEAM)
    .filter((name) => readFileSync(join(runtimeDir, name), "utf8").includes("generativelanguage.googleapis.com"));
  assert.deepEqual(offenders, [],
    `these files assemble a model endpoint themselves; route them through ${SEAM}'s endpointFor(): ${offenders.join(", ")}`);
});

test("the seam assembles both the URL and the credential", () => {
  const { endpointFor } = require(join(runtimeDir, SEAM));
  const built = endpointFor("some-model", "SECRET-KEY");
  assert.ok(built.url.includes("some-model"), "the model must reach the URL");
  assert.ok(built.url.includes("SECRET-KEY"), "the credential must be applied by the seam, not by callers");
  assert.ok(built.headers && built.headers["content-type"], "the seam owns the request headers");
});

test("no runtime file outside the seam reads a provider key from the environment", () => {
  const offenders = readdirSync(runtimeDir)
    .filter((name) => name.endsWith(".cjs") && name !== SEAM)
    .filter((name) => /process\.env\.(GOOGLE_AI_API_KEY_POOL|GEMINI_API_KEY)\b/.test(readFileSync(join(runtimeDir, name), "utf8")));
  assert.deepEqual(offenders, [],
    `the key pool belongs to ${SEAM}; a local key read cannot rotate or rest: ${offenders.join(", ")}`);
});
