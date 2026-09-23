import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE HEADLESS CATALOG BATCH MAY NOT BECOME A SECOND PRODUCER (2026-09-23).
 *
 * `wallpro_designs` was empty on production and the only way to fill it was a
 * human on `/admin/wallpro-batch`, whose every pixel step is `<canvas>`. The
 * runner added here fills it from a dispatch instead -- and the whole risk of
 * doing that is RULE 0.21: a headless copy of the batch pipeline would be a
 * second thing deciding what a catalog row is, and the two would drift.
 *
 * So the design is "drive the real producer, restate nothing", and these are
 * the properties that keep it true. The one genuinely new thing is `sharp`
 * standing in for `<canvas>` to decode and re-encode pixels; that is a
 * transport swap, and it is deliberately the ONLY exception.
 *
 * The deploy-flag lesson is re-asserted here too, because this workflow has a
 * boolean input and that is exactly where it bit last time: an Actions
 * expression written `cond && '' || value` evaluates to the literal value on
 * BOTH branches, which is how four A.T.L.A.S. routing flags silently reset
 * themselves (CLAUDE.md, "the sticky flags did not stick"). A `dry_run` that
 * inverts is a batch that writes to a public catalog when it was told to plan.
 */
const root = resolve(import.meta.dirname, "..");
const read = (rel) => readFileSync(resolve(root, rel), "utf8");
const RUNNER = read("scripts/wallpro-catalog-batch.mjs");
const LIB = read("scripts/wallpro-catalog-lib.ts");
const WORKFLOW = read(".github/workflows/publish-wall-catalog.yml");

test("the runner imports the catalog rules and restates none of them", () => {
  // Every rule below is a decision about what a publishable row IS. A second
  // copy of any of them is the drift RULE 0.21 forbids.
  for (const fn of [
    "designUpsertRow", "catalogMasterPath", "catalogThumbPath", "briefForEntry",
    "batchDimensions", "engineForDesignType", "selectLibraryEntries",
    "measureSeam", "blendSeamless", "seamLadder", "shouldTryBlend", "seamlessReceipt",
  ]) {
    assert.match(RUNNER, new RegExp(`\\b${fn}\\b`), `${fn} is used`);
    assert.ok(
      !new RegExp(`(function|const)\\s+${fn}\\b`).test(RUNNER),
      `${fn} must be imported from the app, never defined in the runner`,
    );
  }
  assert.match(RUNNER, /from '\.\/catalog-lib\.mjs'/);
});

test("the bundled library is a re-export surface and adds no logic", () => {
  // If this file ever grows a rule of its own, that rule exists in two places.
  const body = LIB.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const statements = body.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of statements) {
    assert.ok(
      /^(export\s*\{|\}\s*from|export\s*\{[\s\S]*\}\s*from|[A-Za-z_][\w]*,?|'[^']*';?)/.test(line),
      `wallpro-catalog-lib.ts must only re-export; found: ${line}`,
    );
  }
  assert.ok(!/=>|function\s|\bclass\b/.test(body), "the re-export surface must contain no logic");
});

test("the design itself is never authored here — the edge function makes it", () => {
  // The personas, the prompt assembly and the storage path all belong to the
  // one edge function the customer designer calls. A direct provider call here
  // would be a second generator with its own prompt.
  assert.match(RUNNER, /functions\/v1\/generate-wall-design/);
  assert.ok(!/generativelanguage\.googleapis\.com/.test(RUNNER), "the runner must not call the model directly");
  assert.ok(!/GOOGLE_AI_API_KEY|GEMINI_API_KEY/.test(RUNNER), "the runner must not hold a provider key");
  // And it must reach that function as a real user, because the function keys
  // the storage folder and the charge decision on the resolved user id.
  assert.match(RUNNER, /admin\/generate_link/);
  assert.match(RUNNER, /Authorization: `Bearer \$\{auth\.token\}`/);
});

test("the ledger settles the outcome, not the HTTP response", () => {
  // Same rule the app's own generateWall follows: a transport failure over a
  // completed generation is a success, and the row carries the real refusal.
  assert.match(RUNNER, /if \(!res\.ok\) await res\.text\(\)/);
  assert.match(RUNNER, /state === 'completed' && row\.artwork_path/);
  assert.match(RUNNER, /state === 'failed'/);
});

test("bytes land before the row that names them", () => {
  // A catalog row whose master 404s is worse than no row at all.
  const upload = RUNNER.indexOf("if (decided.mime) await storageUpload(masterPath");
  const upsert = RUNNER.indexOf("wallpro_designs?on_conflict=design_id");
  assert.ok(upload > 0 && upsert > 0 && upload < upsert, "storage must be written before the catalog row");
});

test("a mural carries no seam receipt and a repeat cannot publish without one", () => {
  // The table's own CHECK is `mode <> 'repeat' OR seam IS NOT NULL`; the app's
  // designUpsertRow additionally demands `verified`. The runner must feed it a
  // receipt measured on real pixels, never a fabricated one.
  assert.match(RUNNER, /if \(mode !== 'repeat'\) return \{ bytes, receipt: null, mime: null \}/);
  assert.ok(!/verified:\s*true/.test(RUNNER), "the runner must never hand-write a verified receipt");
  assert.match(RUNNER, /seamlessReceipt\('auto', before, method === 'blend' \? after : null, method\)/);
});

test("only a blend rewrites the master; verified and mirror publish what the model returned", () => {
  assert.match(RUNNER, /method === 'blend'\s*\?\s*\{ bytes: blendedBytes/);
});

test("the workflow is protected, plans by default, and its boolean does not invert", () => {
  assert.match(WORKFLOW, /default: DO_NOT_PUBLISH/);
  assert.match(WORKFLOW, /inputs\.confirmation == 'PUBLISH_WALL_CATALOG'/);
  // dry_run defaults to true: the first dispatch of a thing that writes to a
  // public catalog must be the one that writes nothing.
  const dry = WORKFLOW.slice(WORKFLOW.indexOf("dry_run:"), WORKFLOW.indexOf("count:"));
  assert.match(dry, /type: boolean/);
  assert.match(dry, /default: true/);
  // The Actions truthiness trap, verbatim from CLAUDE.md: the inverted form
  // returns the value on BOTH branches. Value on true, empty on false.
  assert.match(WORKFLOW, /inputs\.dry_run && '1' \|\| ''/);
  // Judge the EXPRESSIONS, not the prose. The comment beside that input warns
  // about the inverted form by quoting it, and an assertion that reads the
  // whole file convicts its own warning -- which this lock did on first run.
  const code = WORKFLOW.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  assert.ok(!/&&\s*''\s*\|\|/.test(code), "never write the inverted truthiness form in a workflow");
  // And the warning itself must survive, or the next session deletes the
  // comment to silence a lock and loses the reason with it.
  assert.match(WORKFLOW, /Never `cond && '' \|\| value`/);
});

test("the service key is read on the droplet and never travels as an argument", () => {
  // It is not a GitHub secret by design; it lives in runtime.env and reaches
  // the container as an --env-file, so it is never in an argv a `ps` can read.
  assert.match(WORKFLOW, /--env-file "\$env_file"/);
  assert.match(WORKFLOW, /\/opt\/designproai-os\/shared\/runtime\.env/);
  assert.ok(!/secrets\.[A-Z_]*SERVICE_ROLE/.test(WORKFLOW), "the service key must not be a GitHub secret");
  assert.ok(!/-e "?SUPABASE_SERVICE_ROLE_KEY=/.test(WORKFLOW), "the key must not be passed as an argument");
  assert.match(WORKFLOW, /hostname\)" = "\$EXPECTED_HOSTNAME"/);
});

test("the runner never prints the curator token or the key", () => {
  const logged = RUNNER.match(/console\.(log|error)\([^\n]*/g) || [];
  for (const line of logged) {
    assert.ok(!/\btoken\b|SERVICE_KEY|access_token|hashed/.test(line), `a credential reaches the log: ${line}`);
  }
});

test("a curator who is not admin or tester is refused before anything is written", () => {
  assert.match(RUNNER, /is not an admin or tester/);
  const check = RUNNER.indexOf("requireCurator(auth.userId)");
  const publish = RUNNER.indexOf("await publishOne(");
  assert.ok(check > 0 && publish > 0 && check < publish, "roles must be checked before the first publish");
});

test("a headless batch stages hidden; only an explicit --live reaches a customer", () => {
  // Owner, 2026-09-23: "I'd rather check the library first make sure it's
  // good." The admin page publishes approved+active because a human just
  // looked at the design. Nobody looked at these, so the public SELECT
  // policy (is_active AND approval_status='approved') must exclude them by
  // construction rather than by anyone remembering to hide them.
  assert.match(RUNNER, /const GO_LIVE = flag\('live'\)/);
  assert.match(RUNNER, /approvalStatus: GO_LIVE \? 'approved' : 'generated', isActive: GO_LIVE/);
  // The row must never be able to go live without that flag being read.
  assert.ok(!/approvalStatus: 'approved'(?!\s*:)/.test(RUNNER), "the runner must not hard-code an approved row");
  assert.ok(!/isActive: true/.test(RUNNER), "the runner must not hard-code an active row");
});

test("the workflow stages by default and a typo hides rather than ships", () => {
  const vis = WORKFLOW.slice(WORKFLOW.indexOf("visibility:"), WORKFLOW.indexOf("curator_email:"));
  assert.match(vis, /default: staged/);
  assert.match(vis, /options: \[staged, live\]/);
  // Equality against the one live value, so anything else -- including a
  // value a future edit adds -- resolves to empty and stages.
  assert.match(WORKFLOW, /inputs\.visibility == 'live' && '1' \|\| ''/);
  assert.match(WORKFLOW, /\$\{P_LIVE:\+--live\}/);
});

test("staging is a shared rule, not a second definition of a row", () => {
  // The runner does NOT post-process the row designUpsertRow returned; the
  // draft carries the intent and the app's own validator applies it, so the
  // admin page and the batch cannot disagree about what a staged row is.
  const CATALOG = read("app/src/lib/wallpro-catalog.ts");
  assert.match(CATALOG, /approval_status: draft\.approvalStatus \?\? \('approved'/);
  assert.match(CATALOG, /is_active: draft\.isActive \?\? true/);
  // Absent means today's behaviour, so the admin page's row is unchanged.
  assert.ok(!/row\.approval_status\s*=/.test(RUNNER), "the runner must not mutate the validated row");
  assert.ok(!/row\.is_active\s*=/.test(RUNNER), "the runner must not mutate the validated row");
});

test("the parser reads the argument form the workflow actually passes", async () => {
  // THIS IS THE CASE TWELVE GREEN LOCKS DID NOT HAVE. The first dry run reached
  // the droplet, started the container and died on `Pass --email=<curator>`,
  // because the parser took only `--email=value` while the workflow passes
  // `--email "value"`. Every lock had matched strings in the file; none had
  // ever run the parser. So this one runs it, on the exact vector the workflow
  // builds -- a fixture laxer than the real thing catches nothing.
  const { arg, flag } = await import("../scripts/wallpro-catalog-args.mjs");

  const asWorkflowPasses = [
    "--email", "trish@weprintwraps.com",
    "--count", "12", "--mode", "mural", "--domain", "all", "--dry-run",
  ];
  assert.equal(arg(asWorkflowPasses, "email"), "trish@weprintwraps.com");
  assert.equal(arg(asWorkflowPasses, "count"), "12");
  assert.equal(arg(asWorkflowPasses, "mode"), "mural");
  assert.equal(arg(asWorkflowPasses, "domain"), "all");
  assert.equal(flag(asWorkflowPasses, "dry-run"), true);
  assert.equal(flag(asWorkflowPasses, "live"), false);

  // The equals form keeps working, and both forms agree.
  const equalsForm = ["--email=trish@weprintwraps.com", "--count=12", "--live"];
  assert.equal(arg(equalsForm, "email"), "trish@weprintwraps.com");
  assert.equal(arg(equalsForm, "count"), "12");
  assert.equal(flag(equalsForm, "live"), true);

  // A switch immediately before another switch has no value to steal, or
  // `--dry-run --mode mural` would read "mural" as the dry-run's argument.
  assert.equal(arg(["--dry-run", "--mode", "mural"], "dry-run", null), null);
  assert.equal(arg(["--dry-run", "--mode", "mural"], "mode"), "mural");
  // A trailing switch must not read past the end of the vector.
  assert.equal(arg(["--mode"], "mode", "fallback"), "fallback");
  assert.equal(arg([], "email", null), null);
});

test("the workflow ships the parser it imports", () => {
  // The runner imports a sibling module; a payload without it dies on import
  // inside the container, after the SSH hop has already succeeded.
  assert.match(RUNNER, /from '\.\/wallpro-catalog-args\.mjs'/);
  assert.match(WORKFLOW, /tar -cz[^\n]*scripts\/wallpro-catalog-args\.mjs/);
  // Every local module the runner imports must be in that tar.
  const tarLine = WORKFLOW.split("\n").find((l) => l.includes("tar -cz"));
  for (const [, spec] of RUNNER.matchAll(/from '(\.\/[^']+)'/g)) {
    const file = spec.replace("./", "scripts/");
    assert.ok(tarLine.includes(file), `${file} is imported but never shipped`);
  }
});

test("re-running skips what is already published", () => {
  assert.match(RUNNER, /selectLibraryEntries\(library, \{ domain: DOMAIN \}, published\)/);
  assert.match(RUNNER, /wallpro_designs\?select=design_id/);
});
