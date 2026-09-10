# ATLAS response persistence incident — 9 September 2026

## Roof finishing — cause located in the live logs; finishing made recoverable and non-fatal

The Supabase unified log stream for the project was readable through the
Supabase MCP connector in this session (`function_edge_logs`, `function_logs`,
`edge_logs`), which is the access the two audit runs below were refused. The
roof exchange, exactly as logged (all times UTC, 9 September 2026):

| time | event |
|---|---|
| 22:30:45.421 | runtime reads the roof finishing checkpoint: `GET 400` (none exists) |
| 22:30:47.404 | `GET ?action=atlas-provider-capabilities` → 200 (203 ms) |
| ~22:30:47.5 | runtime `POST design-panel-ai-generate` for `panel:roof:1` |
| 22:30:49 | edge writes the roof provider claim (incident ledger, unchanged) |
| 22:31:19.036 | edge answers **`POST 409`** after **31,610 ms**; there is **no** `atlas-panel …: roof responded` line and no response fragment |
| 22:31:19.093 | request row `f5f1d8ce…` marked `failed`, `provider_outcome_unknown`, `retryable: false` |

Every other finishing call in the same run logged `responded in 31–38 s` and
returned 200, so the roof exchange ended inside the window where Gemini
normally answers. The edge returned its own structured 409 JSON, which means
its handler was alive and caught an exception from the Gemini `fetch()` or
from reading the response body; it was not a 546 resource kill of the isolate.
With Edge v93 the wrapper discarded that exception, so the phase and exception
class are not recoverable for this occurrence. Edge v94 records them
(`failure.json`) for the next one.

What the logs also show, and the ledger did not: Passenger and Hood each made
**two** finishing calls (`b8702ea5`/`b83ceaca`, `f5ad4952`/`84ce256e`), i.e.
attempt 1 was refused by the runtime's candidate checks and attempt 2 was spent,
at ~35 s each. That is a cost/latency finding for the finishing pass itself
(`masterFinishing.surfaces[].reason` will name the refusal on the next completed
run) and is separate from the roof interruption.

### The defect that turned one interrupted edit into a dead generation

`callAtlasPanelEdge` had no recovery path for an interrupted or unknown finishing
exchange: it threw `provider_outcome_unknown`, `finishPanel` rethrew every
`provider_*` code, and `generateOrReuseFlatAtlas` failed the whole request as
terminal, with the accepted Call-1 master already in hand and three finished
sheets checkpointed. The proof transport (`runtime/atlas-proof-transport.cjs`)
already solved this shape with bounded cache-only reads; the finishing transport
did not have it.

| Code | Change |
|---|---|
| `runtime/atlas-authoring-transport.cjs` (PR #349, merged first) | `invokeAtlasAuthoring`: 180 s operation deadline; after an interrupted exchange or an explicit edge `provider_outcome_unknown`, up to three re-reads of the SAME request with `providerRequest.cacheOnly: true`. A cache-only read can only return a banked response; it cannot claim, invoke Gemini or spend. Both Call 1 and finishing use it |
| `runtime/atlas-panel-authoring.cjs` `finishingFailureDisposition` | one table: `provider_outcome_unknown` and any other `provider_*` → **retain the deterministic crop for that surface and stop** (never the second candidate); edge refusal with `providerOutcome: not_sent` (request too large, input download) → the existing second, smaller request; other `flat_atlas_*` / `operator_required` → throw as before |
| `runtime/flat-first-atlas.cjs` `masterFinishing.surfaces[]` | carries `providerOutcome`, so a receipt never reads as six finished sheets when one is the cut |
| `supabase/functions/design-panel-ai-generate/index.ts` `handleAtlasPanel` | `attach` and `downloadHistoryImage` use the single-pass `encodeBase64` the 546 guard already uses, instead of `String.fromCharCode` + string concatenation + `btoa` per attachment (subject sheet, master, up to five siblings, up to three replayed exchanges) |

The retained crop is exactly what a measured candidate refusal already produced;
it is valid by cut, the whole-master gates still run on the assembled sheet, and
the private finishing checkpoint records the retained outcome so a restart does
not re-ask the provider. No image request is ever issued against an unresolved
one, and no creative conditioning, gate, prompt version, geometry or bleed changes.

- [x] Read the roof invocation logs (above); the audit-run 403 was a credential
  scope issue, not a missing log.
- [x] Finishing transport: deadline + bounded cache-only recovery (PR #349's
  shared `invokeAtlasAuthoring`, mirrored from the proof transport).
- [x] Finishing disposition: an unresolved or refused optional edit retains its
  crop and the cascade continues; contract and storage failures still throw.
- [x] Locked by `tests/atlas-authoring-recovery.test.mjs` (unresolved hood →
  run publishes with hood retained and the chain not advanced; interrupted
  request / interrupted body → one send, three cache-only reads, crop
  retained; recorded edge 409 → one send, crop retained; banked response recovered by one cache-only read; storage
  failure still resumes with exact signed exchanges) and
  `tests/atlas-panel-authoring.test.mjs` (disposition table; 429/503/unknown →
  one exchange; `not_sent` → second smaller request).
- [x] Merged as `30fb883` (PR #350, on top of #349). Runtime deployed by
  dispatch run 34420405953 at 00:18 UTC 2026-09-10 with `atlas_panel_finish: off`;
  Edge `design-panel-ai-generate` deployed by run 34419707541 (attempt 2, after
  a Supabase CLI rate-limit failure on attempt 1) at 00:07 UTC.
- [x] Requeued request `f5f1d8ce-cd5e-47fc-88af-43b82cd06622` at 00:25:11 UTC
  (state `failed` → `queued`, lease and error cleared, identity and receipt kept,
  `engine_receipt.finishingOffRequeue` recorded). With finishing off the run
  reused the banked Call-1 image under `master:1` (`providerCacheHit: true`,
  edge request `d99ac668…`, 8,066,908 bytes, no new image spend) and did not
  enter the finishing cascade (`masterFinishing` is JSON null).
- [x] **Observed, 2026-09-10:** `outputs_ready` at 00:26:53 UTC, 1 min 42 s after
  requeue. Accepted master `cb765b0f…` (4096×4096, `masterQcPassed: true`,
  output class not blocking, prompt version
  `designpro-flat-first-atlas-20260901.v23-orthographic-restored`); six panels
  driver `c96804c6` · passenger `39a0d28d` · hood `09e6c050` · front `dca04ef8`
  · rear `78831bfa` · roof `6fca5703`, every `sourceMasterHash` equal to the
  master; seven proofs persisted 00:26:48–00:26:51 (side, roof, hood_detail,
  passenger-side, front, close-up, rear) by `persona-photographer-render`,
  each bound to its surface panel hash. The Call 8–11 handoff was fired as the
  owner at 00:31 UTC (the browser was not on the page); entice run
  `482d70a0…` completed at 00:32:33 UTC: revision.freeze, panels.build,
  logos.extract, panels.delogo, proof.build (`flat-proof` `c1848f81…`),
  pack.verify, pack.activate, with six `panel` and six `qc-panel` artifacts.
- [ ] Owner visual inspection in RevisionStudioIQ and PanelProStudio. Hashes
  and gates are verified above; the artwork itself has not been looked at by a
  person. Human print QC, Topaz, ZIP and WrapBox remain the production-pack
  half and were not run here.

## Earlier status — Call 1 recovered; roof finishing was blocked

The original JPEG rejection is repaired and deployed. The same New Aura request
then resumed at 22:26:39 UTC, read its saved Call-1 response, and stored private
finishing checkpoints for Driver, Passenger and Hood. It failed at 22:31:19 UTC
on `panel:roof:1` with `provider_outcome_unknown`. There is still **no accepted
master, no published six-panel set and no seven-proof set**. Do not tell the owner
to test a completed pipeline or mark the output ready.

The roof provider claim was saved at 22:30:49 UTC under key
`1fa307fe60bc878cf7212e16a927817c79a5d2556169272cc126bf9fd3c3943d`.
It has no response completion record or saved response fragments. No roof
second-attempt claim was created. The master authoring fence and all IDs remain
unchanged. The finishing checkpoints record candidates/retained source results;
they are not a final whole-master approval.

The old provider wrapper discards every exception thrown by both `fetch()` and
`response.json()`. Consequently the stored error cannot distinguish a network
interruption, an unreadable success body, or a known HTTP rejection whose body
was not JSON. None of those specific causes has been proved for this roof call.

The protected read-only log capture in [PR #346](https://github.com/Tdill1980/designproai-os/pull/346)
was refused by Supabase with **HTTP 403** at 22:38:53 UTC:
[audit run 34413238157](https://github.com/Tdill1980/designproai-os/actions/runs/34413238157).
The same read was refused again at 23:00:22 UTC in
[audit run 34414912681](https://github.com/Tdill1980/designproai-os/actions/runs/34414912681);
its response supplied none of the predefined diagnostic terms.
No alternate credential or access bypass was attempted. The exact denial reason
is not established from status alone. Restore authorized analytics-log access
for the existing production automation credential, or have an authorized
operator provide the `design-panel-ai-generate` invocation
and runtime logs for 22:30–22:32 UTC on 9 September. The documented permission
is `analytics_logs_read` (`analytics:read` for OAuth), per the
[Supabase logs API](https://supabase.com/docs/reference/api/v1-get-project-logs).

### Failure reporting correction

- [x] Add `captureGeminiHttpExchange()` around the two existing ATLAS provider
  requests. It sends once and retains known HTTP error status even if JSON
  parsing fails; it does not fabricate a provider payload.
- [x] Persist sanitized phase, exception class, received HTTP status and elapsed
  time in a private immutable failure record when a response is interrupted.
  Unknown outcomes retain their claim and remain operator-required.
- [x] Replay the same diagnostic after restart, with request/output identity
  checks; no diagnostic contains exception text, tokens, prompts or signatures.
- [x] Pass 31 focused native-format, persistence and transport checks, including
  non-JSON 400/429/503 responses, truncated 200, missing headers, failed diagnostic
  writes and restart without a second provider call.
- [x] Retain the existing explicit single-fetch source checks and pass all 59
  focused handler/finishing/cache checks after their syntax expectation surfaced
  in CI. No assertion was relaxed.
- [x] Pass the exact [PR #347 release gate 34414481498](https://github.com/Tdill1980/designproai-os/actions/runs/34414481498)
  for `744803c145acba92ad62833cdc99ff522a9aaa07`; application contracts,
  Supabase shadow and immutable archive all passed. Merged as `447a1253cc72754bad3389dc510c598da4d28846`,
  with the identical tested tree `4a4386aa99feb1da739ea6fdc95c9f06a003a7f0`.
- [x] Deploy `design-panel-ai-generate` **v94 ACTIVE at 23:00:24 UTC** and
  compare all 14 deployed files byte-for-byte with the tested source; all match.
  Bundle SHA-256: `4c7a6457f016abec8ec4ffcec1573ec427af65d9c130d39997996d0f594a6e9b`.
  Server `960bebc` and photographer v40 remain the deployed versions; this
  compatible Edge correction required no server cutover or schema change.
- [ ] Obtain the denied roof invocation logs and resolve its unknown outcome
  without deleting the claim or inventing a replacement/approval.
- [ ] Finish the original six-panel and seven-proof run, then permit owner testing.

This reporting correction cannot reconstruct an old response that was never
saved, and does not by itself fix the unresolved roof interruption.

### Runtime authoring/finishing recovery follow-up

Further code inspection found that the server's Call-1 and panel-finishing
transports had no bounded same-operation lookup after a lost response. A panel
could therefore stop on an interrupted HTTP acknowledgement even when the Edge
had saved, or was still saving, the result. The runtime also discarded the new
v94 diagnostic fields before saving the generation error.

- [x] Implement `runtime/atlas-authoring-transport.cjs`: one initial POST, then
  at most three cache-only reads with the unchanged request/attempt/artwork.
  Capability checks, response parsing and recovery share a 180-second maximum.
- [x] Preserve only validated phase, exception class, HTTP status and elapsed
  time on the runtime exception and in the existing failure-message field.
  Prompts, arbitrary exception text and thought signatures stay out of it.
- [x] Stop on identity/permission rejection or an already recorded provider
  failure; do not advance a candidate, overwrite a claim or buy another image.
- [x] Pass focused transport, finishing/restart, parent-revision, native-format
  and release-packaging checks. The new packaged module changes the exact
  runtime inventory from 78 to 79; the assertion and inventory both name it.
- [ ] Pass the exact release gate and deploy this server follow-up.
- [ ] Resolve the old roof operation and complete the real ATLAS. This transport
  change cannot create a response that the provider/cache never retained.

Production was re-read at 23:26:05 UTC: the same request remains failed,
attempt 2, with zero accepted masters and zero proofs. No recovery mutation or
new model request was made during this follow-up.

## Repaired Call-1 failure — saved image rejected by PNG-only parser

At 21:42:59 UTC the owner submitted New Aura Day Spa, 2021 Lamborghini Urus.
Request `f5f1d8ce-cd5e-47fc-88af-43b82cd06622`, generation
`664d054d-b10e-4bdf-b7e2-d188f32ce53a`, design `DID-664D054D` failed at
21:43:59 UTC with `atlas_artboard_final_image_mime_invalid`. This run happened
**after** the 21:13 UTC deployment; deployment timing is not this failure.

The Call-1 IDs were reserved before authoring: ATLAS revision
`cfb323a0-3011-482e-a180-060e21f5b95a`, handoff revision
`091cbcdb-b62d-4d4b-b3c0-79281a99311f`. No accepted master or proofs existed at
failure. Storage has 26 response fragments and a completion record. That is
better evidence than the earlier truncated Harvest Moon response, but a
completion record alone is not proof the image is decodable.

Confirmed cause: `selectFinalGenerateContentImage` selected the final non-thought
image, then rejected any MIME other than `image/png`. The Edge writer also
hardcoded `.png` and `image/png`; accepting JPEG while keeping those labels
would corrupt provenance and signed-history replay. Both revision history
readers contained the same PNG-only restriction.

| Code | Change |
|---|---|
| `_shared/gemini-image-history.mjs` | Admit PNG/JPEG/WebP; validate base64 and container bytes; retain native MIME, extension and opaque signed parts |
| `design-panel-ai-generate/index.ts` | Store Call-1 and finishing outputs with their actual native MIME and extension; native Buffer decode and SHA-256; no extra image request |
| `runtime/flat-first-atlas.cjs` | Verify the raw receipt MIME against the image decoder; retain existing canonical PNG normalization and six-surface acceptance checks |
| `runtime/atlas-revision-intake.cjs`, `_shared/gemini-provider-cache.mjs` | Replay original PNG/JPEG/WebP parent exchanges without changing image bytes or signature attachment; retain hash and owner checks |
| `runtime/inspect-atlas-provider-cache.cjs` | Use the production cache reader to verify every saved fragment and full response hash; fully decode the native image and report only dimensions, MIME and hashes |
| `.github/workflows/deploy-production.yml` | Explicit marker selects a read-only inspection of this exact reported request after deployment; no design, lease, approval or notification mutation |

- [x] Identify the exact new failed request, error and reserved IDs.
- [x] Fix PNG-only response admission and truthful native artifact storage.
- [x] Fix both parent-history readers for the same formats.
- [x] Pass 62 focused image-format, cache, history, authoring and inspection checks.
- [x] Pass [PR-head release gate 34410462993](https://github.com/Tdill1980/designproai-os/actions/runs/34410462993) and
  [merged-main gate 34411102368](https://github.com/Tdill1980/designproai-os/actions/runs/34411102368), including application, database, archive and Docker checks.
- [x] Deploy [PR #345](https://github.com/Tdill1980/designproai-os/pull/345) as
  server `960bebcd9ce47225a8b24b24840017e00f7d2a10`; both runtime replicas,
  gateway and web passed [deployment 34411688380](https://github.com/Tdill1980/designproai-os/actions/runs/34411688380)
  acceptance at 22:24:17 UTC.
- [x] Deploy `design-panel-ai-generate` v93 at 22:25:40 UTC; all 14 deployed
  files match checked source. `persona-photographer-render` v40 is retained.
- [x] At 22:24:37 UTC, verify all 26 saved fragments and fully decode the
  original **4096 × 4096 JPEG**, 8,066,908 bytes, with one opaque signed part.
  Response SHA-256: `e7ec199caaecaed0252771943ccf0a10c37ba77cafe008122d7dc7517a444b9f`.
  Image SHA-256: `b15326546c132933ee45204f167e3de9cfebcfd0896420ff78f6487573fc1a7b`.
  Inspection made zero writes and zero provider calls; master attempt 2 has no claim.
- [x] At 22:26:36 UTC, queue only the exact failed request after verified image
  completion, preserving its immutable authoring fence, input, IDs, version and
  attempt count. The old error and verification hashes were recorded on its
  recovery receipt. This authorizes cache-only recovery of Call 1, not a reroll.
- [x] Recover Call 1 from the verified saved image under the same IDs.
- [ ] Finish recovery beyond the separate roof-finishing failure above.
- [ ] Observe accepted master, six panels, seven proofs and deterministic Call 8.

The fix changes encoding transport, not the creative model, prompt, ATLAS
layout, dimensions, bleed, panel acceptance, studio layout or QC policy.
The provider's original response remains immutable. Human print QC and the
separate PanelProFileOutput template/output trial remain open.

## Earlier proof transport repair — deployed; subsequent owner run failed at Call 1

The Call-1 response repair remains deployed. A separate defect was confirmed in
the existing 3D proof path: `createAtlasDesignPanelProvider` ignored the slot's
timeout and exposed four runtime attempts around `handleAtlasProof`'s three
image attempts. A single unsuccessful camera shot could therefore buy twelve
image requests. Each Edge invocation also minted a different proof request ID,
so a lost HTTP acknowledgement could not recover a proof already produced.

The reference is `restylepro-os@113d137dbe8813ca3bf70c8d7265ad081ebd4524`,
`supabase/functions/persona-photographer-render/index.ts`, adapted here in
`handleAtlasProof`. The pinned presentation/camera/studio modules are unchanged.
Durable operation claims and caller deadlines are standalone transport concerns;
they do not change the six-surface source interface or manufacturing geometry.

- [x] Persist each camera's complete native response and opaque signatures under
  the existing private provider-cache contract; preserve request/generation IDs.
- [x] Recover a lost proof response using bounded cache-only reads. An authenticated
  capability read prevents an older Edge from interpreting recovery as generation.
- [x] Limit ATLAS to one slot-level provider operation. Only a persisted, explicit
  429 rate-limit rejection advances the existing three-entry model ladder.
- [x] Stop indefinite waits in HTTP bodies and Storage reads; each camera's transport
  has one 180-second maximum including recovery, not a fresh deadline per retry.
- [x] Authorize the internal caller and active generation lease before reading
  a panel or spending on a new image. Verify returned surface/revision lineage.
- [x] Select exactly one final image; thought images and ambiguous final returns
  cannot be published as customer proofs. This closes a selection defect, not
  the still-open visual logo/creative-quality acceptance item.
- [x] Pass 35 focused recovery, authority and orchestration checks locally.
- [x] Pass the full local application/build/contract checks and all 59 package
  checks after adding the new module to the exact inventory count.
- [x] Pass the [exact PR-head release gate](https://github.com/Tdill1980/designproai-os/actions/runs/34403884110)
  for `757625d7b41f5e80df27fb84a53a23a34b78c054`.
- [x] Merge [PR #343](https://github.com/Tdill1980/designproai-os/pull/343) as
  `e0e515ba88f1f2d5b04430dd712c5be40a05c1d4`; its tree exactly matches the checked source.
- [x] Deploy `persona-photographer-render` version 40 and compare all 11 deployed
  files byte-for-byte against the checked source; all match, function ACTIVE.
- [x] Pass [exact merged-main CI](https://github.com/Tdill1980/designproai-os/actions/runs/34404643031),
  including application, database, reproducible archive and Docker image checks.
- [x] Complete [server deployment](https://github.com/Tdill1980/designproai-os/actions/runs/34405288320)
  and confirm both replicas accepted `e0e515ba88f1f2d5b04430dd712c5be40a05c1d4`.
  At 21:13:06 UTC the deployment reported the web, gateway and both exact-SHA
  runtime replicas installed; loopback acceptance passed at 21:13:12 UTC.
- [ ] Confirm a fresh customer-visible ATLAS run on the new release.

Roll out the compatible photographer Edge first, then the exact tested server
artifact. Old in-flight server requests retain their compatibility branch;
new runtime requests require the durable contract. No migration is needed.
Keep the new Edge available when rolling back a server with in-flight proof
operations. Do not roll the Edge back underneath the new runtime.

Owner instruction after the browser outage: stop browser retries, finish the
repair and tell Trish when the deployed release is ready for her test. The
owner submitted the run documented above on that release; it exposed the
PNG-only admission defect before proofs started. No post-repair UI generation
has been claimed as passed. The seven proofs, six panels and Call 8 remain the
owner's visible acceptance boundary, followed by actual human production QC.

References: [Supabase runtime limits](https://supabase.com/docs/guides/functions/limits)
and [Google retry guidance](https://ai.google.dev/gemini-api/docs/troubleshooting).
The application is deliberately stricter on uncertain paid image outcomes:
it recovers the original operation instead of silently issuing another one.

This is the investigation and release record for the failed Harvest Moon Coffee
design. A checked code or test item does not mean that a new design completed.

## Exact customer run

| Field | Verified value |
|---|---|
| Vehicle / design | 2022 Ford Transit Connect / Harvest Moon Coffee |
| GenerationID | `e9babe2d-043e-4ce4-9b7f-5e93b2739b09` |
| DesignID | `DID-E9BABE2D` |
| Request ID | `5f1da626-6912-4aab-8ba5-d704ab2b6ea3` |
| Reserved ATLAS revision | `d5302306-af10-4ce0-bd0e-ea0a682f17bc` |
| Reserved manufacturing handoff | `6fa3c821-d7f2-4e73-9f1a-a259414ba8c9` |
| Admission / final failure | 17:15:02.838 / 17:16:06.294 UTC |
| Server / Edge at failure | `7eb2fb9eb943e91fd659f5d796f36f2bf096807c` / `design-panel-ai-generate` v91 |
| Final state | `failed`, `provider_outcome_unknown`, attempt 2 |
| Accepted output | No accepted master, six-panel set, or seven-proof set |

The Call 1 identity correction worked for this request: the distinct IDs were
reserved at admission and remain on the failed request. A reserved ATLAS ID is
not evidence that an accepted ATLAS image exists. The screenshot's build is the
deployed release; this failure was not caused by testing an older front end
while that release was still deploying.

## Failure boundary

The private provider claim was saved at 17:15:20.712 UTC. Three result chunks
were then saved at 17:15:53.928, 17:15:54.576 and 17:15:55.192. Each stored JSON
chunk is 5,592,419 bytes, representing 4 MiB of the serialized native exchange.
There is no completed `response.json` receipt.

The code only starts saving result chunks after the provider invocation returns
a status and parsed payload. Therefore some provider response was received.
Saving that response failed before the completion receipt and before ATLAS
validation. The subsequent cache lookup correctly refused to claim that an
incomplete response was a complete image. It did not authorize another model
call. No accepted artwork has been reconstructed from the partial chunks.

The shared helper deployed at the time of failure was downloaded and compared with the repository:
both SHA-256 hashes are
`663837cd12b1188c72a7ea157b0e7f8baa2a325250d1ab1f4ab879aeca4585be`.

The old writer serializes the complete provider response plus the original
request, creates another full byte buffer, and base64-encodes already encoded
images again through JavaScript string conversion. A representative valid 4K
PNG reproduced excessive CPU and memory in this exact code. This establishes
the resource problem; a live Edge shutdown log is still needed to distinguish
the exact production CPU/memory termination reason from other interruptions.
Supabase documents a 2-second CPU budget and 256 MB memory limit per Edge
request. [Supabase Edge limits](https://supabase.com/docs/guides/functions/limits).

## Correction and ownership

| Code | Behavior |
|---|---|
| `supabase/functions/_shared/gemini-provider-cache.mjs` | Serialize bounded native JSON tokens into small UTF-8 JSON fragments; incremental hashing; bounded storage writes; publish the completion receipt only after every chunk is durable |
| Same shared helper, replay | Verify paths, counts, byte lengths, hashes and encoding; read both legacy base64 receipts and new text fragments; preserve all native model parts and signatures |
| `app/src/lib/designpro-generation-error.ts` | Identify an unconfirmed provider outcome independently of customer-facing text |
| `app/src/components/designpanelpro/DesignGenerationFailure.tsx` | Explain the ATLAS failure; link to the exact saved record and RevisionStudioIQ; offer no fresh generation for an unknown outcome |
| `app/src/hooks/useDesignPanelProLogic.ts` | Preserve request/GenerationID and failed status; guard a duplicate submission even after the visible error is cleared |
| `app/src/pages/DesignPanelProPremium.tsx` and `AiPanelGenerator.tsx` | Use ATLAS wording and prevent the ambiguous-error action from discarding GENIE preparation |
| `runtime/inspect-atlas-provider-cache.cjs` | Read-only inspection of the exact stored response; report completeness and hashes without exposing native prompts, signatures, credentials or image bytes |
| `.github/workflows/deploy-production.yml` | A merge explicitly marked `[inspect-atlas-e9babe2d]` runs that read-only inspection on the deployed runtime after its normal acceptance checks |

The six-surface authoring prompt, model settings, extraction rotations, GENIE
dimensions, five-inch bleed, existing history, accepted artifact identities and
quality gates do not change. The private fragment encoding is storage transport,
not a different creative pipeline. No Gemini retry is introduced.

The new helper uses Deno-supported Node compatibility APIs for bounded buffers
and incremental hashes. [Deno Node API support](https://docs.deno.com/runtime/reference/node_apis/).

## Measured regression and acceptance

The local resource fixture uses a valid 4096×4096 PNG (22,471,524 bytes) and a
valid 2048×2048 reference PNG (5,621,177 bytes), native thought signatures, the
complete private request and a filesystem storage adapter. It makes zero
network or paid model calls. These figures measure persistence, not the full
live Edge request, image quality, or a customer delivery.

| Measurement | Deployed baseline | Bounded writer, initial measurement |
|---|---:|---:|
| Persistence CPU | 2,147 ms | 256 ms |
| Observed persistence process RSS | 341 MiB | 141 MiB |
| Stored bytes | 49,947,746 | 37,472,931 |

Network round-trip time is absent from that fixture. Smaller fragments need
more writes; concurrency is bounded so latency improvements do not reintroduce
full-response buffering. Full native response parsing and replay parsing remain
separate memory consumers, particularly at the 64 MiB response cap.

The final implementation permits at most **two simultaneous chunk writes**.
A subsequent run measured baseline 2,952 ms CPU / 341 MiB observed RSS and final
candidate 252 ms / 142 MiB, with the same stored bytes. Three controlled tests
verify the concurrency bound, out-of-order completion, and failure draining.
All 22 cache helper tests pass. The full local non-Docker release gate also
passed; the exact committed CI gate remains mandatory before deployment.

Reproduce with any owned valid PNG fixtures, without provider calls:

```sh
node scripts/benchmark-atlas-provider-cache.mjs --output-png /path/to/4k.png --reference-png /path/to/reference.png --baseline 7eb2fb9
```

- [x] Bound the report to the actual failed customer request and deployed source.
- [x] Reproduce the old persistence resource problem with a valid 4K image.
- [x] Implement bounded persistence and backward-compatible, hash-checked replay.
- [x] Test exact preservation of Unicode, native parts, signatures and request data.
- [x] Test interrupted saving, corrupt chunks and no second model invocation.
- [x] Test the rendered error card and hook behavior preserving the failed run.
- [x] Build the application with the ATLAS wording and guarded controls.
- [x] Authenticate the browser and open the actual customer's PanelProStudio route.
- [x] Complete exact-commit release CI and server rollout.
- [x] Deploy and verify the matching Edge writer after compatible runtime readers.
- [x] Inspect the partial production cache and establish whether any complete native image survived: the stored native payload is incomplete.
- [ ] Demonstrate a successful actual ATLAS generation and matching six panels/seven proofs in the UI.
- [ ] Resolve logo/design degradation and complete the physical output/QC/WrapBox acceptance gates.

## Production release and actual UI status

| Gate | Verified evidence |
|---|---|
| Reviewed change | [PR #341](https://github.com/Tdill1980/designproai-os/pull/341), tested head `537847aa4ab0b1e16656f00abe68f39ab13375f6` |
| PR-head CI | [34384916660](https://github.com/Tdill1980/designproai-os/actions/runs/34384916660), successful |
| Merged code | `27c0e2c6538b7d17b6a39a4446f5ebe18d3c8bdf` |
| Exact merged-main CI | [34386075305](https://github.com/Tdill1980/designproai-os/actions/runs/34386075305), successful on attempt 2; application/contracts passed on attempt 1, and the temporary Supabase environment's post-reset 502 passed on retry with all 327 database checks |
| Server deployment | [34387109272](https://github.com/Tdill1980/designproai-os/actions/runs/34387109272), successful; web, gateway and both exact-SHA runtime replicas accepted at 18:11 UTC |
| Edge writer | `design-panel-ai-generate` version 92 active at 18:12 UTC, after runtime reader acceptance; all 14 deployed files compared byte-for-byte with the tested source |
| Edge bundle | SHA-256 `de4397b89306e50e8f982e34b9740b1f3bf901aa7fff1018ed18939cf095b84a`; existing custom-auth configuration preserved |
| Original response inspection | Completed at 18:11:50 UTC: 3 intact stored chunks / 12,582,912 native-envelope bytes, no completion receipt, no complete native payload, no complete final image, and no second authoring claim |
| Original record | Still failed with its original IDs and evidence intact; inspection performed zero writes and zero provider calls |
| Fresh UI generation | **Not run.** The signed-in browser connection stalled after deployment while checking the new build, before Generate was clicked |

The original response cannot be reconstructed into a complete image from the
banked chunks alone. Do not promote those bytes or silently reset the claim.
There is no recovered accepted ATLAS for `DID-E9BABE2D`.

The actual signed-in PanelProStudio record was examined before this release:
it showed the correct failed generation, no accepted master, 0/6 panels and 0/7
proofs, with approval controls disabled. This was a real UI inspection, not a
successful generation test. Browser control briefly reconnected, then stalled
again after the production update. A post-Edge database check found no new
generation requests. The ATLAS creation form was inspected, but not submitted.

To finish acceptance, restore the existing browser connection, reload and verify
build `27c0e2c`, submit one fresh Harvest Moon regression design through the normal
UI, and record its new request/GenerationID/DesignID. Verify its accepted master,
six source panels, seven same-revision proofs and deterministic Call 8 proof in
DesignProAI, RevisionStudioIQ and PanelProStudio, with visible screenshots and
artifact lineage checks. Do not use the production-canary script or fabricate
human QC, production approval, or notifications to complete this test.

## Rollout and recovery rules

Deploy the compatible runtime reader before the Edge writer. The public cache
and request-claim contract remains v1; new completion receipts carry an explicit
fragment encoding. Older readers cannot read that encoding. Rollback must retain
the compatible reader for already banked new receipts; reverting only to an old
reader would break replay of those responses.

The failed customer request and its claim remain untouched during deployment.
Do not delete its claim, relabel partial data as accepted, change its identity,
or silently issue another model call. The scoped inspection distinguishes a
complete stored envelope, a complete native payload inside a truncated envelope,
and a truncated image. Any recovery must preserve that distinction.

Component rendering and unit tests are not a successful browser generation.
An HTML fixture exists for review, but its local browser preview was blocked;
no screenshot of that fixture is claimed. The real signed-in browser remains the
required acceptance surface. The earlier deployment verification was
insufficient to claim a successful new ATLAS run, and this release's fresh UI
test remains explicitly incomplete.
