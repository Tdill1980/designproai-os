# Owner-authorized Fast Edge command

This is a restricted trigger for the existing `Deploy Edge Hotfix` workflow,
not a replacement deployment lane. See [Fast Deploy Path](FAST-DEPLOY-PATH.md).

## Use from a connected agent

After the owner explicitly requests a deployment:

1. Read current `main` in `Tdill1980/designproai-os`; use its full 40-character SHA.
2. Find the merged, same-repository PR that contains the selected function's
   isolated source change. Do not post on a deployment-tooling PR or an open PR.
3. Post exactly one fresh, single-line PR conversation comment as `Tdill1980`:

   `/deploy-edge render-wall-view EXACT_CURRENT_MAIN_SHA DEPLOY_EDGE_TO_DESIGNPROAI_PRODUCTION`

   Replace `EXACT_CURRENT_MAIN_SHA` with the actual SHA, not a branch name.
   `production-panel-proof` is also supported by the existing allowlist.
4. Inspect `Request Fast Edge from owner PR command`, followed by the new
   `Deploy Edge Hotfix` run. Read actual job checkout/inputs, not only run head SHA.
5. Report deployment complete only after the existing lane passes its tests,
   selected-function build, Supabase deployment and live source/version readback.
   A successful command trigger means DISPATCHED, not DEPLOYED.

For a live authorization/routing check with no deployment, substitute
`/check-edge` for `/deploy-edge`. The same authorization and PR checks run, but
no workflow dispatch is made. This does not test Supabase or design quality.

## Restrictions

Only a newly created comment from account `Tdill1980` (numeric ID `210197216`)
may trigger a request. Sender, comment author, workflow actor and triggering actor
must agree. Bots, forks, ordinary issues, open/unmerged PRs, edited comments,
malformed commands, extra lines and reruns of a command event are rejected.

The event repository must be `Tdill1980/designproai-os` (ID `1325983419`) with
`main` as default branch. The requested SHA must match the event's default-branch
SHA and live main, checked again immediately before dispatch. The PR's merged
commit must be an ancestor of that SHA. All changed-file pages are checked
against the existing function-specific policy; mixed or protected changes fail.

The trigger checks out ONLY the trusted default-branch event SHA. Comment text
is parsed as data and is never interpolated into a shell command or executed.
It uses the short-lived built-in GitHub token with `contents: read`, `issues:
read`, `pull-requests: read`, and `actions: write` for this job only. It has no
Supabase credentials and does not set secrets or modify any production data.

The existing deployment workflow remains the only writer. Its production
environment approvals, focused tests, complete-source packaging, exact-main
checks, dependency-drift checks, JWT policy preservation, production-write mutex
and Supabase readback are unchanged. No function is deployed automatically when
a PR merges. There is no deploy-all or protected-path override command.

A failed/uncertain dispatch is NOT retried automatically. Inspect Actions first;
then resolve main again and post a fresh explicit command when appropriate.

## Installation scope

The trigger workflow, adapter, tests and this document are deployment
infrastructure, not a Fast Edge function patch. Their PR must receive the normal
infrastructure review/checks. They do not request a droplet rollout or a database
migration. Subsequent selected-function requests use the existing Fast Edge lane.

To disable command requests, disable only `Request Fast Edge from owner PR
command` in GitHub Actions. Manual Fast Edge workflow dispatch remains available.
