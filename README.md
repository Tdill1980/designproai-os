# DesignProAI OS standalone release

This release is separate from RestylePro and does not use PR #4119, Railway,
`/opt/restylepro`, port 3100, or port 8080. It preserves the existing
VectorizIt service on host port 3200.

## Implemented operating-system chain

1. Persist and byte-identify seven distinct required vehicle views.
2. Automatically resolve the GENIE Universal Panelizer manifest.
3. Automatically create the eighth asset: the flat 2D proof.
4. Verify per-surface trim dimensions, 5-inch bleed on every edge,
   per-surface square footage, total square footage, and seven-view lineage.
5. Automatically run the ninth operation: six unique own-region panel
   extracts. Driver/passenger reuse and source-region reuse are rejected.
6. Automatically run Call 10 logo inventory and bind every expected logo by
   identity, surface, storage path, bytes, and content hash.
7. Finalize and activate the Entice pack.
8. Stop at PanelPro for the first human approval.
9. Produce and verify production output, stop at final human QC, then stamp,
   ZIP, and publish the exact WrapBox manifest.

The browser submits immutable input, displays status, and records the two human
approvals. It cannot manually advance production stages. Workers continue when
the browser and all chat sessions are closed.

## Release contents

- `release/`: exact web, gateway, and two-worker runtime payload.
- `migrations/`: seven ordered standalone PostgreSQL/Supabase migrations.
- `ops/`: guarded DigitalOcean install, deploy, acceptance, rollback, and
  individually gated legacy-service retirement scripts.
- `designproai-release.tgz`: server deployment archive.
- `SHA256SUMS`: release archive checksum.

## Mandatory release gates

Do not switch production traffic until all gates pass:

1. Apply all seven migrations, in filename order, to a brand-new disposable
   Supabase/PostgreSQL shadow database. Any SQL error blocks deployment.
2. Create a new private `designproai-os` repository and record its exact
   40-character commit SHA.
3. On `143.110.237.145`, run `ops/inventory.sh` and `ops/backup.sh` first.
4. Populate root-owned `/opt/designproai/shared/runtime.env` and `gateway.env`
   without printing secrets. Runtime uses the service-role key; gateway uses
   only the anonymous key and authenticated user JWTs.
5. Deploy with the guarded `ops/deploy.sh` using the exact repository SHA.
6. Prove both worker identities, gateway health, web health, and VectorizIt
   health before and after deployment.
7. Run the distressed-Porsche canary through the entire automatic chain,
   including a forced worker interruption and resume.
8. Point `os.designproai.com` only after the local canary succeeds.

## Protected host rules

- Never stop or change port 3200 / `rp-vectorize`.
- Never delete or modify `/opt/restylepro`.
- Never run broad `pm2 kill`, Docker prune/stop, or `docker compose down`.
- Do not retire 3100, 8080, or media-parser through this DP deployment.
- Do not run or merge PR #4119.

The code and static contracts pass 37/37 tests. The fresh shadow-database apply
and real server canary require authenticated infrastructure access and are not
represented as complete until they actually run.
