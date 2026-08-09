# DesignProAI suite extraction status — 2026-08-08

This audit is pinned to standalone target `b0cf022396a22b86d6a0b471aef82af5e375606e` and historical source `bdb26365904e91be446894e84b01b4a24f64aac0`.

The executable source cannot be copied as a working first migration slice. The old `src/App.tsx` is a 67 KB mixed router containing DesignProAI, RestylePro, WPW, marketing, CRM, Vercel recovery and admin routes. Its Supabase client hard-pins RestylePro project `kfapjdyythzyvnpdeghu`. Copying it would silently reconnect the new DesignProAI server to RestylePro data and would violate the standalone runtime contract.

The machine-readable evidence and every audited blob identity are in `docs/migration/2026-08-08-suite-source-provenance.json`.

## ALREADY COMPLETE

- Standalone production kernel commit and source-suite commit identified exactly.
- DesignPro generation, MyVehiclePro, Gallery, shell/auth, RevisionStudio, PanelPro workspace, ProductionFlow and WrapBox entrypoints inventoried.
- Current generation prompt/model/view-angle sources recorded by immutable Git blob SHA.

## VERIFIED WORKING

- The standalone target already owns authentication, immutable revision ingest, GENIE validation, Calls 8–11 production stages, QC gates and WrapBox delivery.
- Its gateway exposes `/api/auth`, `/api/assets`, `/api/genie`, `/api/jobs`, `/api/revisions`, `/api/production` and `/api/wrapbox` families.
- Its runtime contract explicitly prohibits the legacy shared objects used by the old UI, including `color_visualizations`, `designiq_generations`, `panelizer_jobs`, `production_flow_assets` and `user_roles`.

## NEEDS FIX

- Add an authenticated server-owned Calls 1–7 adapter to the standalone gateway and isolated DesignProAI schema.
- Split the DesignPro-only shell/auth from the mixed RestylePro/WPW router rather than copying the old shell.
- Port the source generation engine under byte/behavior locks for the recorded blobs; do not alter prompts, models, seeds or view angles.

## MISSING

- Standalone MyVehiclePro API and storage closure.
- Standalone Gallery read model and API.
- Git-visible immutable identity for the Porsche Martini production artifact. The repository contains the generation source, but not the exact output row/storage receipt needed to prove the canary.

## BLOCKED

- A direct DesignPro/MyVehiclePro/Gallery UI PR is blocked because its current dependencies would either fail against the isolated target or reconnect to the RestylePro Supabase project.

## First executable migration PR

The next code PR must be the standalone Calls 1–7 generation adapter. It must expose server-owned authenticated generation endpoints, persist only to the isolated `designpro_*` model, preserve the recorded source blobs, and hand accepted generation results into the existing Calls 8–11 worker path. After that contract is green, the DesignPro shell and generation page become a bounded executable extraction; MyVehiclePro and Gallery follow behind their own server APIs.

No deployment, Supabase production mutation, DNS change, RestylePro change, prompt change or Calls 8–11 change is included in this audit PR.
