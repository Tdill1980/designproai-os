# ATLAS response persistence incident — 9 September 2026

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

The deployed shared helper was downloaded and compared with the repository:
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
- [ ] Complete exact-commit release CI and server rollout.
- [ ] Deploy and verify the matching Edge writer after compatible runtime readers.
- [ ] Inspect the partial production cache and establish whether any complete native image survived.
- [ ] Demonstrate a successful actual ATLAS generation and matching six panels/seven proofs in the UI.
- [ ] Resolve logo/design degradation and complete the physical output/QC/WrapBox acceptance gates.

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

Browser component rendering and unit tests were performed before asking the
customer to test. An HTML fixture exists for review, but the browser blocked its
local file preview; no screenshot of that fixture is claimed. The now signed-in
production browser is the remaining place to establish real end-to-end UI
evidence. The earlier deployment verification was insufficient to claim a
successful new ATLAS run.
