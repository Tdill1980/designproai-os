# DesignProAI suite extraction status — 2026-08-08

This audit is pinned to standalone target `b0cf022396a22b86d6a0b471aef82af5e375606e` and historical source `bdb26365904e91be446894e84b01b4a24f64aac0`.

The executable source cannot be copied as a working first migration slice. The old `src/App.tsx` is a 67 KB mixed router containing DesignProAI, RestylePro, WPW, marketing, CRM, Vercel recovery and admin routes. Its Supabase client hard-pins RestylePro project `kfapjdyythzyvnpdeghu`. Copying it would silently reconnect the new DesignProAI server to RestylePro data and would violate the standalone runtime contract.

The machine-readable suite source inventory and audited Git blob identities remain in `docs/migration/2026-08-08-suite-source-provenance.json`. The Porsche Martini canary evidence below was verified read-only in the historical source on 2026-08-08. No source or target Supabase row, Storage object, migration, deployment, DNS record or server was changed by that verification.

## ALREADY COMPLETE

- Standalone production kernel commit and source-suite commit identified exactly.
- DesignPro generation, MyVehiclePro, Gallery, shell/auth, RevisionStudio, PanelPro workspace, ProductionFlow and WrapBox entrypoints inventoried.
- Current generation prompt/model/view-angle sources recorded by immutable Git blob SHA.
- The exact Porsche Martini generation row and all seven distinct source-view objects have been identified read-only; signed/public object URLs, storage paths and user identity are intentionally excluded from this repository record.

## VERIFIED WORKING

- The standalone target already owns authentication, immutable revision ingest, GENIE validation, Calls 8–11 production stages, QC gates and WrapBox delivery.
- Its gateway exposes `/api/auth`, `/api/assets`, `/api/genie`, `/api/jobs`, `/api/revisions`, `/api/production` and `/api/wrapbox` families.
- Its runtime contract explicitly prohibits the legacy shared objects used by the old UI, including `color_visualizations`, `designiq_generations`, `panelizer_jobs`, `production_flow_assets` and `user_roles`.
- Porsche Martini Calls 1–7 are verified: generation `9bd3ba61-648c-4959-9576-59563cebf435` reached `all_views`, and its seven source objects were present and distinct.
- Porsche Martini Call 8 is verified: the first production run completed freeze, manifest, proof and artboard stages with six GENIE-sized flat proof surfaces, exact 5-inch bleed and a recorded total of 168 sq ft.

## NEEDS FIX

- Add an authenticated server-owned Calls 1–7 adapter to the standalone gateway and isolated DesignProAI schema.
- Split the DesignPro-only shell/auth from the mixed RestylePro/WPW router rather than copying the old shell.
- Port the source generation engine under byte/behavior locks for the recorded blobs; do not alter prompts, models, seeds or view angles.
- Fix Call 9 downstream deterministic panel extraction. The verified Call 8 proof is not the defect: driver and passenger panel candidates reintroduced vehicle silhouettes and non-full-bleed gaps while hood, roof, front and rear passed QC.
- Resolve the explicit source-view contract mismatch (`side`, `passenger-side`, `hood_detail`, `close-up`) without silently relabelling views to the standalone keys (`driver`, `passenger`, `hood`, `hero3d`).

## MISSING

- Standalone MyVehiclePro API and storage closure.
- Standalone Gallery read model and API.
- A target-side Porsche row/object copy and immutable SHA-256 migration receipt. No Porsche row or object has been migrated into the isolated target project.
- Verified Calls 10–11/Entice activation for this canary; the first run stopped at Call 9 and later retries failed earlier proof-rebuild gates.

## BLOCKED

- A direct DesignPro/MyVehiclePro/Gallery UI PR is blocked because its current dependencies would either fail against the isolated target or reconnect to the RestylePro Supabase project.
- Porsche target migration and production canary activation are blocked until the isolated Calls 1–7 adapter/schema and an exact copy receipt are reviewed. The frozen source generation must not be regenerated to bypass that gate.

## Frozen Porsche Martini canary

### Calls 1–7 — verified and frozen

- Generation ID: `9bd3ba61-648c-4959-9576-59563cebf435`
- Vehicle: 2024 Porsche 911 Turbo
- Raw prompt: `Distressed Porsche martini race team livery`
- Engine/status: `4.0.0` / `all_views`
- Created/updated: `2026-08-05 10:22:58.096118+00` / `2026-08-05 10:23:59.155204+00`
- Prompt hash: `82006ee447c19d3789ae2d9da097f9a728d9053ffed93085754e5ef424ae52f3`
- Concept fingerprint: `2024:porsche:911 turbo:restyle:82006ee447c19d37`

The seven verified source objects are JPEGs with distinct object identities. Only the historical view key and byte count are recorded here:

| Historical view key | Bytes |
| --- | ---: |
| `side` | 8,524,784 |
| `passenger-side` | 7,346,110 |
| `hood_detail` | 8,135,645 |
| `front` | 7,298,932 |
| `rear` | 6,894,074 |
| `close-up` | 7,800,496 |
| `roof` | 8,345,628 |

This generation is the frozen migration canary. Do not regenerate it, change its prompt/model/seed/view-angle behavior, or infer a `hero3d`/surface mapping from a different historical label. Preserve `sourceViewType` and fail closed when an explicit semantic mapping is unavailable.

### Call 8 — verified

The first workflow run, `50d33946-8703-43f1-99b5-45d3abda0491`, completed `revision.freeze`, `manifest.resolve`, `proof.build` and `artboards.build`. It produced six surfaces with exact 5-inch bleed:

| Surface | GENIE print size (inches) |
| --- | ---: |
| Driver side | 170 × 40 |
| Passenger side | 170 × 40 |
| Hood | 64 × 42 |
| Roof | 60 × 56 |
| Front | 115 × 27 |
| Rear | 64 × 23 |

- Recorded total: 168 sq ft
- Manifest hash: `fa45c98aa477ed77a0369302d069d46ab1adc40525a2134a1a7b9f6ab536b4fd`
- Dimension-basis hash: `49aa95f8ece780ab984b2f872b2d7dec736f5ac5fc152a15e718da943f6d3ea5`
- Proof SHA-256: `16c761654cc6eb304339f74189801f0f45c87de6e5a3aea099727b33d82a91b1`
- Proof hash: `f25792b8f9f43a5eb9be00349a954f118e1529c7448b9665d8d8c980b37e78ec`
- Source-evidence hash: `5840a890e0377f1d4a5fe8024627e95890c53ad66046e9f5e1351b40859007b7`
- Proof bytes / invocation count: 1,043,115 / 1

Clean and branded artboards completed without a recorded failure. This evidence freezes Call 8 as working for the canary; rebuilding it is not the Call 9 fix.

### Call 9 — downstream broken

`panels.build` failed with `honest_panel_gap`: `No proof-fed extraction passed QC for: DRIVER SIDE, PASSENGER SIDE`. QC found vehicle silhouettes, windows, mirrors, wheel arches, white margins or cutouts in the two side candidates, violating full-bleed/no-vehicle requirements. Hood, roof, front and rear reached passing candidates, so the failure is isolated to downstream side-panel extraction rather than Calls 1–8.

Later attempts did not supersede the verified Call 8 receipt. They failed closed at earlier rebuild gates:

1. `call7_overlay_artifact_missing`: hood overlay 3 lacked separate rebuild and hard-cut outputs.
2. `panel_artboard_generator_failed`: branding element 2 lacked `box_2d`.
3. `proof_source_view_missing`: passenger-side source view was missing from that retry.
4. Two retries exhausted five attempts while erasing the `PORSCHE` text pass.

Calls 10–11, Entice activation, production-pack delivery and WrapBox push are not verified for this canary because Call 9 did not complete. They must remain pending rather than be duplicated or bypassed.

## First executable migration PR

The next code PR must be the standalone Calls 1–7 generation adapter. It must expose server-owned authenticated generation endpoints, persist only to the isolated `designpro_*` model, preserve the recorded source blobs, and hand accepted generation results into the existing Calls 8–11 worker path. After that contract is green, the DesignPro shell and generation page become a bounded executable extraction; MyVehiclePro and Gallery follow behind their own server APIs.

No deployment, Supabase production mutation, DNS change, RestylePro change, prompt change or Calls 8–11 code change is included in this documentation PR.
