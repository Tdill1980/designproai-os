// THE LIBRARY'S TIMESTAMPS MUST NAME THE RIGHT UNIT.
//
// DesignLibrary's relativeAge walked a [divisor, unit] table whose units were
// off by one, so every card understated its age by a whole unit once past a
// minute: a design authored 17 hours earlier read "17 minutes ago" (live
// 2026-08-27, RevisionStudioIQ). Stale work looking fresh is worse than no
// timestamp, so the mapping is asserted rather than eyeballed.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveEsbuild } from "../scripts/build-control-prompt.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const source = readFileSync(
  join(ROOT, "app", "src", "components", "revisioniq", "DesignLibrary.tsx"),
  "utf8",
);

// Bundle just the function, so the assertions run the REAL implementation
// without pulling React and every UI dependency into the test.
const work = mkdtempSync(join(tmpdir(), "design-library-age-"));
const start = source.indexOf("export function relativeAge(");
const end = source.indexOf("\n}\n", start) + 3;
assert.ok(start > 0 && end > start, "relativeAge must be exported for this lock");
writeFileSync(join(work, "age.ts"), source.slice(start, end));
const out = join(work, "age.mjs");
execFileSync(resolveEsbuild(), [
  join(work, "age.ts"), "--bundle", "--format=esm", `--outfile=${out}`, "--log-level=warning",
], { stdio: "pipe" });
const { relativeAge } = await import(pathToFileURL(out).href);

const NOW = Date.parse("2026-08-27T02:50:00.000Z");
const ago = (seconds) => relativeAge(new Date(NOW - seconds * 1000).toISOString(), NOW);

test("each step names the unit it divided INTO, never the one it left", () => {
  assert.equal(ago(30), "just now");
  assert.equal(ago(50), "50 seconds ago");
  assert.equal(ago(90), "1 minute ago");
  assert.equal(ago(45 * 60), "45 minutes ago");
  assert.equal(ago(60 * 60), "1 hour ago");
  // The exact case from the owner's screenshot: 17h10m, shown as "17 minutes".
  assert.equal(ago(17 * 3600 + 10 * 60), "17 hours ago");
  assert.equal(ago(3 * 86400), "3 days ago");
  assert.equal(ago(21 * 86400), "3 weeks ago");
});

test("a missing or unparseable timestamp is honest, not zero", () => {
  assert.equal(relativeAge(null, NOW), "—");
  assert.equal(relativeAge("not a date", NOW), "—");
});
