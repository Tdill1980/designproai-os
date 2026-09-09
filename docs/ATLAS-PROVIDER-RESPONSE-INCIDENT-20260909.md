# ATLAS response persistence incident — 9 September 2026

## Follow-on proof transport repair — deployed, ready for owner UI acceptance

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
repair and tell Trish when the deployed release is ready for her test. That
release is now ready: hard-refresh `https://os.designproai.com/designpro/create`,
confirm build `e0e515b`, and submit one new design. No post-repair UI generation
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
