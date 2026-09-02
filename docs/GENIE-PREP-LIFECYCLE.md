# GENIE Prep — the early lifecycle (owner ruling, Trish 2026-09-02)

**Rule:** GENIE knows dimensions before DesignPanelAI generates. DesignPanelAI may use vehicle context for
design intent, but never owns production dimensions. A.T.L.A.S. owns canonical creative authority, and
GENIE compiles that authority into vehicle-specific physical files. Prepared geometry is PRIVATE OS
state and never enters the Gemini model-facing request.

## The defect this corrects

The 2026-09-02 lifecycle trace (`docs/GENIE-LIFECYCLE-TRACE-2026-09-02.md`) found the intended behaviour was never
wired: the intake's "Design Prep" was a catalog-only peek held in React state; the GenerationID was
browser-minted and first reached the server inside the Generate POST; the authoritative resolver
`resolveFlatAtlasPreviewDimensions` ran inline in the worker as a hard, untimed dependency of Call 1
(`runtime/generation-worker.cjs`). On a catalog miss that put a 25–90 s grounding round-trip between
Generate and the creative call.

## The lifecycle

```text
CUSTOMER                                   DESIGNPROAI SERVER
Year / Make / Model complete (or Enter)
   │  POST /api/genie/prep {generationId, vehicle, clientEnteredAt}
   ▼
gateway binds owner = session user ──────► runtime POST /internal/genie/prep
                                             vehicleIdentityHash(vehicle)   ← ONE normalizer (resolver's)
                                             request_designpro_genie_prep   ← idempotent on the triple
                                             claim_designpro_genie_prep     ← lease
                                             202 receipt (status, provenance; no inches)
                                             └─ background: resolveFlatAtlasPreviewDimensions
                                                complete_… (geometry, manifest hash, state, duration)
customer keeps writing … polls GET /api/genie/prep/:generationId (RLS, status only)
   │
   ▼  Generate (same GenerationID; nothing about the prep is sent)
worker claim → read_designpro_genie_prep(owner, generationId, vehicleIdentityHash, contract)
   ├─ READY  → dimensionRow = prep.geometry · consume_… · prepHit=true · geometryMsAvoided=prep.duration
   └─ else   → resolveFlatAtlasPreviewDimensions (inline, unchanged) · prepHit=false
genieMs measured either way → metadata.callOneTimings.genieMs, metadata.geniePrep
   │
   ▼  Call 1 (request body byte-identical either way) → A.T.L.A.S. → six deterministic files
```

## Schema — `public.designpro_genie_preps` (`supabase/migrations/20260902120000_designpro_genie_prep.sql`)

| column | meaning |
|---|---|
| `generation_id` | the lifecycle owner (browser-minted UUID, same one Generate sends) |
| `owner_id`, `tenant_key` | the session user; a GenerationID belongs to one owner |
| `vehicle` | the typed vehicle, as received |
| `vehicle_identity_hash` | sha256 of the resolver-normalized identity (class, make, model, year) |
| `genie_contract_version` | `designpro.genie-prep.v1+<manifest contract>` — folds in the manifest contract |
| `status` | `queued · resolving · ready · failed · superseded` |
| `attempt`, `worker_id`, `lease_token`, `lease_expires_at` | claim/lease fencing, attempt cap 3 |
| `geometry` | the resolver's full return (`dimensionRow`), verbatim |
| `geometry_manifest_hash`, `geometry_state`, `production_eligible` | provenance of the prepared geometry |
| `client_entered_at`, `requested_at`, `started_at`, `prepared_at`, `duration_ms` | instrumentation: Enter → ack → start → READY |
| `consumed_at`, `consumed_by_request_id` | which Generate consumed it (once) |
| UNIQUE `(generation_id, vehicle_identity_hash, genie_contract_version)` | the idempotency key |

RLS: owners SELECT their own rows; all writes via SECURITY DEFINER RPCs granted to `service_role` only.

## State machine

```text
request ──► queued ──claim──► resolving ──complete──► ready ──consume──► (consumed_at set)
                                  │
                                  └──fail──► queued  (retryable, attempt < 3)
                                          └► failed
queued | ready | failed ──new vehicle identity for the generation──► superseded
```
A row mid-resolution whose vehicle has been superseded is refused at completion by the lease/status fence
and retired on the next request. A changed vehicle, an older contract, another owner, or any non-READY
status is never consumed: the worker falls back to the inline resolver.

## Instrumentation

| signal | where |
|---|---|
| Enter → server acknowledgment | `client_entered_at` vs `requested_at` |
| GENIE prep start / end / duration | `started_at`, `prepared_at`, `duration_ms` |
| READY timestamp | `prepared_at` |
| Generate timestamp | `designpro_generation_requests.created_at` |
| prepHit, geometry time avoided, GENIE segment | revision `metadata.geniePrep` (`prepHit`, `source`, `prepId`, `requestedAt`, `preparedAt`, `prepDurationMs`, `geometryMsAvoided`, `genieMs`) and `metadata.callOneTimings.genieMs` / `geniePrepHit` |

## Expected latency-path change

| case | before (trace) | after |
|---|---|---|
| catalog / cached-candidate hit | two DB selects on the Generate path (sub-second) | one prep read on the Generate path; the selects ran at Enter |
| catalog miss, grounding | 25 s (measured live) to 90 s (2 × 45 s timeout) BETWEEN Generate and Call 1 | the same work runs while the customer writes; Generate pays one prep read |
| customer faster than prep | n/a | prep not READY → inline resolver, exactly the pre-change path |

Gemini Call 1 (35–45 s) is unchanged and is now the only wait on a known vehicle.

## What does not change

No creative prompt text, no Field Recovery harness change, no artifact shape (RULE 0.5), no gate. The
model-facing request is byte-identical with and without a prep hit
(`tests/genie-prep-lifecycle.test.mjs`).
