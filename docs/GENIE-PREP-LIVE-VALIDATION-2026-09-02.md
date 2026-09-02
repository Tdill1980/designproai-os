# GENIE Prep lifecycle — live validation on os.designproai.com (2026-09-02)

Release `24a8b446` (web, gateway, two exact-SHA runtime replicas; migration
`20260902120000_designpro_genie_prep.sql` applied first). Driven through the
real customer intake at `https://os.designproai.com/designpro` with a headless
browser session as `canary-operator@designproai.com` (`b940320d…`), the same
identity the production canary bootstraps. Every number below was read back
from the production database or the browser's own network log, not from UI copy.

## 1. Enter → prep READY, zero provider calls

| step | value |
|---|---|
| vehicle typed | 2022 Ford F250 Crew Cab · truck |
| Enter pressed (browser) | 20:12:09.123Z |
| `POST /api/genie/prep` | 20:12:09.146Z → 200 `status: resolving` |
| GenerationID (browser-minted) | `ea05e270-6a22-48a9-b4df-7d0dc06fa449` |
| prep row | `c464abb7-3472-4ef3-9ab2-212dfce9d1ce` |
| server `requested_at` / `started_at` / `prepared_at` | 20:12:09.305 / 20:12:09.341 / 20:12:09.446 |
| resolver duration | **78 ms** (`duration_ms`) |
| first poll returned READY | 20:12:11.598Z (2.2 s wall, the app's 2 s poll interval) |
| status path | queued → resolving → ready |
| vehicle identity hash | `6f0f38594c5f5b74f36db24b9593a3fc847e116f4931f467ba4b3a08fdace67a` |
| contract | `designpro.genie-prep.v1+designpro.genie-manifest.v2` |
| geometry state / production eligible | `measured` / `true` |
| manifest contract / hash contract | `designpro.genie-manifest.v2` / `designpro.genie-manifest-hash.v2` |
| manifest hash | `766258a022b2a2da16007affc37ade77ee0af79f7b25f4f74a2039821de75b96` |
| geometry source row | `690ad298-6c8e-4ae2-9571-ea532d6bd6c5` (operator-validated candidate) |
| six dimensions stored (in) | driver 153×56 · passenger 153×56 · hood 71.5×56 · roof 74.3×54.8 · front 129×34 · rear 76×54 |
| generation requests for that GenerationID | 0 |
| Gemini image calls / Flash calls | 0 / 0 (resolver hit the validated row; no grounding ran) |

The local `vehicleIdentityHash` from `runtime/genie-universal-resolver.cjs`
reproduces the deployed hashes byte for byte for both vehicles.

## 2. Vehicle mutation

**Through the UI.** Changing Model to `F350 Crew Cab` and pressing Enter mints
a NEW GenerationID (`changeVehicle` clears `designPrepGenerationId`), so the
stale F250 prep can never be read for the new design by construction: the read
requires owner + GenerationID + vehicle identity + contract to match.

| | |
|---|---|
| new GenerationID / prep | `85249116-72ea-4884-ad50-d21ffcc3a932` / `b4b5a5b0-53f2-4aa6-9b21-6bd38754ec9f` |
| identity hash | `62c9c6da2da27a939c6dfc7fad03f230ca73a8168120210a4a74bb9c13a96e2d` |
| result | READY in 15.8 s, `unresolved`, `production_eligible=false`, reason `no_authoritative_genie_row_for_year_and_configuration` |
| provider | one `gemini-2.5-flash` grounding call inside the existing resolver (same code the inline path runs); zero image calls |

**Same-GenerationID path (RPC).** `request_designpro_genie_prep` for the
ORIGINAL GenerationID `ea05e270…` with the F350 identity hash:
`c464abb7…` (F250) → `superseded`; new row `db753251…` → `queued` → reclaimed
by `designpro-worker-2` through the idle-tick reclaim (crash-recovery path) →
READY in 70 ms as `provisional` (reused the candidate row the UI leg had just
grounded, so no second Flash call).

## 3. Generate consumed the READY prep

Model returned to `F250 Crew Cab`, Enter → GenerationID
`84a3eadf-bc81-4096-8dd0-a63509e84fb7`, prep `a377be67-8dc4-42c9-aeec-8cbd5c314d26`
READY at 20:14:28.696 (166 ms). Brief and company name filled, **Create Design**
clicked at 20:14:57.586Z.

| | |
|---|---|
| `POST /api/generation/requests` | 20:14:57.905Z → 202, request `5a95603e-ff44-41f8-a14b-1bdc047fb33d`, DID-84A3EADF |
| persisted `request_input.vehicle` | `{"year":"2022","make":"Ford","model":"F250 Crew Cab","type":"truck"}` — exactly as typed |
| worker lease | 20:15:02.123 |
| prep consumed | `consumed_at` 20:15:02.219, `consumed_by_request_id` = `5a95603e…` |
| revision `metadata.geniePrep` | `prepHit: true`, `prepId: a377be67…`, `source: genie_prep`, `genieMs: 67`, `prepDurationMs: 166`, `geometryMsAvoided: 166` |
| revision `manifest.geometryResolution.genieManifestHash` | `766258a0…` — identical to the prep |
| inline resolver | not called (`callOneTimings.geniePrepHit: true`, `genieMs: 67`) |
| Call-1 request bytes | `modelRequestByteSize 4761963`, `modelInputImageCount 2`, edge prompt `atlas-artboard-designiq.20260901.v23-orthographic-restored` — the deployed product request, untouched by the prep |

GENIE dimension resolution is removed from the normal Generate critical path
when prep completes before Generate: the worker spent 67 ms reading the prep
instead of running the resolver.

## 4. What the generation produced (timeline)

| event | time | Δ from Create |
|---|---|---|
| Create Design | 20:14:57.6 | 0 |
| worker lease | 20:15:02.1 | +4.5 s |
| Call 1 attempt 1 refused, attempt 2 accepted (`masterAuthoringAttempts 2`, `geminiImageRequestCount 2`, authoring 72.3 s) | | |
| A.T.L.A.S. revision `5ae62498…` written, master `1564c66da0a1c4826459e7ecb1fdde308e9611da1811d9d2e39aa4b408e38f4a` | 20:16:41.6 | +1 m 44 s |
| seven views, `outputs_ready` | 20:17:44.2 | +2 m 47 s |
| entice run `3513f9fa…`: revision.freeze → panels.build (Call 9) → logos.extract (Call 10) → panels.delogo (Call 11) → proof.build (Call 8, 234.04 sq ft, 0 image requests) → pack.verify → pack.activate | 20:17:47 → 20:18:46 | +3 m 49 s |
| production run `c2b2f204…` | parked at `await_purchase` (`purchase_required`) | |

Deterministic checks on the accepted master: every zone opaque 1.0, edge hole
≤0.0004, no cut-outs, no template leak, no repair (`preRepairMasterHash null`,
`cutoutFillApplied []`), output-class gate `flat_atlas` (one Flash call, the
gate RULE 0.30 allows). Six panels cut from `1564c66d…` (all `sourceMasterHash`
equal), Call 9 promoted the same six hashes, Call 11 produced six `qc-panel`
duplicates with the branded set preserved. All thirteen artifacts downloaded
through `/api/jobs/:id/artifacts` hash-verified.

PanelPro (`/designpro/jobs/84a3eadf-bc81-4096-8dd0-a63509e84fb7/panelpro`,
footer build `24a8b44`) shows the accepted master, print panels 6/6, the
proofs, the 2D production proof and the version history.

## 5. Observations outside this deployment's scope (not fixed here)

1. **Creative (frozen by owner ruling):** the v23 master paints wheel-arch
   contours and rocker/body lines into both flanks and body creases into hood
   and roof. Opaque, so no gate convicts it; it is the RULE 0.28/0.32 conditioning
   defect Field Recovery targets.
2. **Rear reads upside down.** The rear region was authored inverted and the
   panel map cuts it at rotation 0, so the rear panel and its tile on the Call 8
   proof read upside down.
3. **Passenger ≈ mirrored driver:** `passengerMirrorMae 0.0042`.
4. **Call 8 proof header** prints `Vehicle: Vehicle` and `A.T.L.A.S. MASTER
   unbound` although the tiles cite `sourceMasterHash 1564c66d…`.
5. **PanelPro "Close-Up not produced yet"** while the seven-view receipt
   carries `closeup 5b257172…`; "3D proofs 6/7".
6. **Geometry provenance:** the READY prep's 153×56 flank comes from an
   operator-validated manual candidate (`690ad298…`, validated 2026-08-30 by the
   canary operator account). GENIE's catalog puts the F-250 Crew Cab flank at
   251×60 (RULE 0.28); 2022 has no catalog row (status board #19). The lifecycle
   consumed the authority the system holds; whether that authority is right is a
   GENIE data question.
7. The refusal reason for Call-1 attempt 1 is not persisted on the revision
   (only the count and both edge request ids `c96603df…`, `05f04553…`).
