import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const hook = readFileSync(join(root, "app", "src", "hooks", "useDesignPanelProLogic.ts"), "utf8");
const page = readFileSync(join(root, "app", "src", "pages", "DesignPanelProPremium.tsx"), "utf8");

/**
 * A vehicle GENIE has never had validated ends Calls 1-7 with a named next step
 * and nothing broken. It was rendering as "Something went wrong." over a
 * Relaunch button, which tells the operator to repeat the one action guaranteed
 * to stop again -- and hides the only thing that actually clears it.
 */
test("a GENIE park is mapped to a block with a route, not to a generic error", () => {
  assert.match(hook, /genie_dimension_validation_required/,
    "the hook must recognise the park code rather than let it fall through to the failure text");
  assert.match(hook, /setGenerationBlock\(\{[\s\S]{0,200}actionHref: "\/designpro\/genie-qc"/,
    "the block must carry the route that resolves it");
  assert.match(hook, /generationBlock,/, "the block must be exported to the surface");
});

test("clearing the error clears the block with it", () => {
  assert.match(hook, /clearGenerationError: \(\) => \{ setGenerationError\(null\); setGenerationBlock\(null\); \}/,
    "a stale block would strand the operator on a state they already resolved");
});

test("the block state is rendered before the crash state, and offers the route instead of a retry", () => {
  const blockAt = page.indexOf("generationBlock ? (");
  const crashAt = page.indexOf("Something went wrong.");
  assert.ok(blockAt > 0, "the page must render a block state");
  assert.ok(blockAt < crashAt,
    "the block branch must come first, or the generic crash state swallows every park");
  // Comments stripped: the branch documents why it does not offer a retry, and
  // a rule must not fail on its own statement.
  const branch = page.slice(blockAt, crashAt)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.match(branch, /navigate\(generationBlock\.actionHref\)/, "the primary action must be the route");
  assert.ok(!/Relaunch/.test(branch), "a park must not offer the retry that will park again");
});
