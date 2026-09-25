# DesignProAI deployment lanes

## Fast Edge

`Deploy Edge Hotfix` is a manual production action. Supply the exact current
40-character main SHA, `production-panel-proof`, and
`DEPLOY_EDGE_TO_DESIGNPROAI_PRODUCTION`. It uses the existing
`designproai-production` environment and `DESIGNPRO_SUPABASE_ACCESS_TOKEN`.
There is no all-functions option, project selector, migration, secret update,
container build or droplet connection in this action.

The reviewed source allowlist starts with exactly
`supabase/functions/production-panel-proof/index.ts`, plus its two named focused
tests. Shared code changes are NOT approved for Fast Edge initially. Existing
unchanged imported modules are bundled, and compared to production before a
write. A shared mismatch requires the full release lane; it is not bypassed.

The last first-parent main integration touching the selected function must
itself be an approved function-only change. Selecting one file from a mixed
integration does not convert that integration into a hotfix. The deployed
checkout must equal current main, be clean, and pass the focused tests. This
lets a later deployment-tooling-only commit coexist with an earlier approved
function hotfix without pretending to deploy the tooling as an Edge function.

Build tools are pinned: esbuild 0.25.9 and the existing Supabase CLI 2.111.0.
The real local import closure is bundled in isolation. The source-SHA module
is stamped inside that isolated bundle only; JWT policy is preserved from live
metadata. The selected function is deployed via API bundling, then its source
is downloaded from Supabase and every local bundle file is SHA-256 compared.
Version, active status, identity and JWT policy are checked, followed by an
OPTIONS request requiring HTTP 200 and the exact X-DesignPro-Source-Sha header.
This smoke test is NOT a paid image generation or a design-quality signoff.

A source/version receipt is attached to the run, without credentials or source
files. Failed readback stays failed even after a successful API write. Inspect
and correct it; do not label that run deployed-and-verified. Rollback is a new
reviewed revert commit on main, not a stale-SHA or bypass option.

The fast and full lanes share the existing production-write concurrency lock
so they cannot overwrite a function simultaneously. The Edge action does not
wait for or invoke the full release/build gate. A production approval or an
already-running production write can still delay it. Two to five minutes is a
design target, not a measured SLA.

## Full release

The existing `Exact DesignProAI release gate` retains its checkout/Compose,
Supabase shadow, reproducible archive/image and protected migration jobs.
Runtime, DAG, gateway, auth, migrations, configuration, deployment tooling,
other functions and all non-allowlisted paths continue to trigger it. Mixed
changes are full releases. This lane-installation PR is itself a full release
change, not an Edge hotfix.

The push and PR path exclusions are literal and tested against the central
allowlist; never replace them with a broad `_shared/**` or function-directory
glob. There are fewer than 300 literals so a truncated 300-file GitHub diff
cannot hide a protected file behind an all-allowed first page. The independent
policy check uses the full local Git diff, not the API's first file page.
A removal, rename, file-mode change or malformed diff cannot deploy through
the hotfix action; use the explicit full release workflow for those cases.

The workflow does not weaken repository or environment permissions. Branch
protection was reported disabled during this inspection; the policy check
can be made required by a repository administrator. Do not path-filter a
required full-release check without updating that branch rule, or GitHub can
leave an Edge-only PR waiting for a check intentionally not started.

## PR #703 finding at inspected main 0a670a64bc2796e4d564e9338b3a21e9798a579b

The real instruction array contains seven strings, while the runtime still
requires `flatProductionInstructions.length === 5`. The separated-artwork
route therefore fails its pre-provider audit. The new focused test exposes
that mismatch rather than skipping it. The existing clean-prompt test also
expects the previous `FLAT PRODUCTION DESTINATION:` wording. Those source/test
changes must be reconciled before an Edge deployment can pass; no production
function has been changed as part of preparing this lane.

Validation performed locally: 26 policy tests, YAML parsing and JavaScript
syntax checks. Isolated mock deployment exercises covered successful source
readback, rejection of shared-source drift before any write, rejection of a
moved main before any write, and failed verification after a mismatched
post-deploy readback. These simulations are not live Supabase deployment proof.
