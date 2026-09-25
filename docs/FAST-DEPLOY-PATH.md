# DesignProAI Fast Deploy Path

**Purpose:** Use this procedure for surgical Supabase Edge Function changes that do not require rebuilding or redeploying the DesignProAI OS/droplet.

Repository: `Tdill1980/designproai-os`

## Standard instruction for the next session

> Use the DesignProAI **Fast Edge deployment lane** for this change.
>
> - This is a surgical Supabase Edge Function change.
> - Do **not** rebuild or redeploy the DesignProAI OS/droplet.
> - Do **not** run the Full Release lane unless the changed paths actually require it.
> - Keep the change isolated to the approved Edge Function and permitted focused tests.
> - Run the focused function tests.
> - Build only that Edge Function.
> - Merge the reviewed change to `main`.
> - Deploy **only** the selected Edge Function to the DesignProAI production Supabase project.
> - Use the exact current `main` SHA.
> - Read the deployed function back from Supabase after deployment.
> - Verify the deployed source matches Git, the function is ACTIVE, its version increased, the existing auth/JWT policy was preserved, and the deployed source SHA matches the exact `main` SHA.
> - Never use a deploy-all Edge Functions operation.
> - Do not touch migrations, runtime/DAG/orchestration, gateway, auth, shared production architecture, secrets, or the droplet unless the requested change actually requires them.
> - If the diff crosses a protected path, **STOP the Fast Edge deployment** and report exactly which path forced the Full Release lane.
> - Do not stop after preparing a PR. Complete test → merge → deploy → Supabase readback unless an actual failing test or protected-path rule blocks deployment.

## Short command

**Fast Edge deploy this to DesignProAI production. Surgical change only. Test → merge → deploy selected function → Supabase readback. Do not run the full OS release.**

## Established deployment architecture

The two-lane deployment architecture was established in PR #705 and validated through PR #706 on September 24, 2026.

### Fast Edge lane

Use for approved isolated Supabase Edge Function changes. The lane uses path-based enforcement, focused tests, an isolated function build, exact-main SHA validation, single-function deployment, and production source/version readback.

For `production-panel-proof`, the Fast Edge lane is operational.

### Full Release lane

Use when a change touches protected architecture, including:

- runtime or DAG/orchestration
- database migrations
- gateway/contracts
- authentication
- shared production architecture
- deployment infrastructure
- protected shared Edge dependencies
- multi-service changes
- any other non-allowlisted path that the deployment policy classifies as Full Release

## Required completion report

After a successful Fast Edge deployment, report:

1. Function name.
2. Production function version.
3. Exact deployed Git SHA.
4. Focused test/build result.
5. Supabase readback result.
6. Confirmation that deployed source matches Git.
7. Confirmation that auth/JWT policy was preserved.
8. Confirmation that no unrelated function, migration, runtime, or droplet was deployed.

## Current known reference

As of September 24, 2026, the Fast Edge lane was merged and validated, and `production-panel-proof` was successfully deployed through the surgical process with source readback verification.
