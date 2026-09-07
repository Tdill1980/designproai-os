import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE BUILD MUST NOT BE ABLE TO LIE ABOUT WHICH COMMIT IT IS.
 *
 * `app/.env.production` carried `VITE_COMMIT_SHA=6ac1909c…`, written by hand on
 * 2026-08-13 and then baked verbatim into every build for the five months
 * after. Nothing ever failed, because a stale constant resolves exactly as
 * cleanly as a true one. The only consumer was `log_client_error`'s
 * `p_app_version`, so every client error logged in that period was filed
 * against a commit that had long stopped being deployed -- which makes "did
 * this release raise the error rate" unanswerable, at the moment the question
 * is worth asking.
 *
 * It was found by accident, checking something else, which is the point: a
 * hand-maintained build stamp has no failure mode that anyone notices. So the
 * rule is mechanical rather than remembered -- the commit is DERIVED, from git,
 * at build time, or it is empty. A literal SHA in a build input is the defect,
 * whatever its value, because a correct literal is one merge away from a wrong
 * one.
 *
 * Static by design, like `app-shell-routing.test.mjs`: proving this needs no
 * browser, no Supabase project and no bundler run.
 */

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

/** Comments here NAME the constant they forbid, so they must not be searched. */
const stripLineComments = (source) => source.replace(/(^|\n)\s*#[^\n]*/g, "$1");
const stripJsComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const FORTY_HEX = /\b[0-9a-f]{40}\b/;

test("no app build input hardcodes a commit SHA", () => {
  const envFiles = readdirSync(resolve(root, "app")).filter((name) => name.startsWith(".env"));
  assert.ok(envFiles.length > 0, "expected at least one app/.env* build input");

  for (const name of envFiles) {
    const body = stripLineComments(read(`app/${name}`));
    assert.doesNotMatch(
      body,
      /VITE_COMMIT_SHA\s*=/,
      `app/${name} defines VITE_COMMIT_SHA; the commit comes from git, not from a checked-in file`,
    );
    assert.doesNotMatch(
      body,
      FORTY_HEX,
      `app/${name} contains a hardcoded 40-character SHA; build inputs must not name a commit`,
    );
  }
});

test("vite resolves the commit from git and injects it", () => {
  const config = read("app/vite.config.ts");
  assert.match(config, /__COMMIT_SHA__:\s*JSON\.stringify\(commitSha\(\)\)/);
  assert.match(
    config,
    /execSync\(\s*"git rev-parse HEAD"/,
    "the commit must be read from git, so it cannot disagree with what was built",
  );
  // The stamp shown in the UI and the stamp attached to errors must be the
  // same fact. Two independent resolutions is how they drifted apart before.
  assert.match(config, /buildId\(commitSha\(\)\)/);
});

test("that git command actually resolves in this checkout", () => {
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  assert.match(sha, /^[0-9a-f]{40}$/, "vite's resolver must be able to name this commit");
});

test("error logging reports the injected commit, never a build-input literal", () => {
  const source = stripJsComments(read("app/src/lib/errorCapture.ts"));
  assert.match(source, /__COMMIT_SHA__/);
  assert.doesNotMatch(
    source,
    /VITE_COMMIT_SHA/,
    "p_app_version must come from the injected commit, not from an env literal",
  );
});

test("the injected constant is declared, so a typo fails typecheck rather than the build stamp", () => {
  assert.match(read("app/src/vite-env.d.ts"), /declare const __COMMIT_SHA__: string;/);
});
