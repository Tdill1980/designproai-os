# Suite migration inventory — measured, not estimated

Source: `Tdill1980/restylepro-os` @ `ab0f0638d2d911e419092f137a8e5dbaaad9681a`
Target: `Tdill1980/designproai-os`
Method: each app's real import graph walked from its entrypoint, then scanned for
Supabase table, edge-function and storage-bucket references.
Reproduce with `node docs/migration/build-suite-closures.mjs`; raw data in
`2026-08-12-suite-app-closures.json`.

This is the single source-of-truth inventory that
`DESIGNPROAI_DETERMINISTIC_END_TO_END_WORKFLOW_2026-08-08.md` lists as required
before cutover.

## Totals

| | |
|---|---|
| Apps | 11 |
| Distinct Supabase tables | 67 |
| Distinct edge functions | 76 |
| Storage buckets | `color-renders`, `extracted-elements`, `patterns`, `wrap-files` |
| Source tree | 1,185 TS/TSX files, 42 MB |

## Per app, ordered by migration difficulty

| App | Files | Lines | Tables | Edge fns | Prohibited tables |
|---|---:|---:|---:|---:|---|
| PanelProStudio | 5 | 15,621 | 4 | 0 | `color_visualizations`, `production_flow_assets` |
| WrapBox | 25 | 19,532 | 12 | 0 | `color_visualizations`, `designiq_generations`, `panelizer_jobs` |
| Gallery | 32 | 20,057 | 14 | 0 | `color_visualizations`, `user_roles` |
| WallPro | 25 | 19,949 | 5 | 4 | `production_flow_assets` |
| MyVehiclePro | 51 | 25,094 | 14 | 10 | `color_visualizations`, `designiq_generations`, `user_roles` |
| RecreatePro | 49 | 28,406 | 4 | 11 | — |
| ProductionFlow | 46 | 32,969 | 17 | 16 | 6 |
| DesignPro (generation) | 136 | 48,108 | 33 | 20 | 4 |
| GraphicsPro | 140 | 49,396 | 31 | 25 | 4 |
| ApprovePro | 114 | 47,029 | 32 | 41 | 6 |
| RevisionStudio | 126 | 56,492 | 33 | 28 | 7 |

Line counts include shared components, so they overlap heavily between apps.
File counts are the honest measure of each closure.

## The actual blocker

**Ten of the eleven apps read tables the standalone runtime contract explicitly
prohibits.** Those seven tables are `color_visualizations`,
`design_version_commits`, `designiq_generations`, `designpro_entice_packs`,
`panelizer_jobs`, `production_flow_assets` and `user_roles` — RestylePro's
shared schema, pinned to project `kfapjdyythzyvnpdeghu`.

This is why the suite was never a copy job, and why "wire it up on the server"
does not describe the work. Each app needs an **isolated server API and read
model** on `designpro_*` objects before its UI can be moved. Moving the UI first
either fails against the isolated project or reconnects this server to
RestylePro data.

Only **RecreatePro** references no prohibited table.

## Suggested order

1. **RecreatePro** — 49 files, 4 tables, no prohibited dependency. The only app
   that can move without inventing a read model first, so it proves the
   extraction pattern cheaply.
2. **WallPro** — 25 files, one prohibited table (`production_flow_assets`).
3. **PanelProStudio, Gallery, WrapBox** — no edge functions at all. Pure UI over
   read models; the work is the isolated API, not the app.
4. **MyVehiclePro** — needs the API and storage closure the audit already lists
   as missing.
5. **DesignPro generation + Calls 1–7 engine** — the repository's stated next
   PR. Vendors the frozen generation blobs under byte/behaviour locks.
6. **GraphicsPro**.
7. **ProductionFlow, ApprovePro, RevisionStudio** — largest closures, most
   prohibited tables, most edge functions. ApprovePro alone touches 41 edge
   functions. These land last.

## Cross-check: the failing pipeline

`panel-artboard-generator`, `generate-2d-proof` and `run-production-flow` are all
edge functions **of this source repository**. The 401s and `504 IDLE_TIMEOUT`
reported against "the pipeline" are failures here, not in `designproai-os`,
which has no Railway runner and whose Call 8 route is `/compose-proof-sheet`.
Two separate systems; keep their incident reports separate.

Note `upscale-panel-to-print` and `upscale-production-panel` in the same list —
that is the purchase-time upscale step, and it is the seam that closes the
resolution gap at `output.build`.

## What this inventory does not do

It maps the client closures. It does not yet map, for each of the 67 tables:
row counts, RLS policies, foreign keys, or which are genuinely shared versus
copy-able. That schema-side inventory is the next measurement, and it decides
how much of the 67 becomes `designpro_*` objects versus is dropped.
