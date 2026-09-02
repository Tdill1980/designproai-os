# Test 1 — the teaching proof's black field is NOT the causal signal

Run [33577484230](https://github.com/Tdill1980/designproai-os/actions/runs/33577484230),
2026-09-02, deployed image `designproai-runtime:fb58f702…`, edge prompt version
`atlas-artboard-designiq.20260901.v23-orthographic-restored`, model
`gemini-3-pro-image`. Capture-only parity first
([33577381637](https://github.com/Tdill1980/designproai-os/actions/runs/33577381637), zero provider calls).

Raw JSON: `docs/ab/teaching-proof-field-ab-33577484230-*.json`. Masters and both
teaching proofs are on the run's artifact.

## The design

| arm | teaching image | executor |
|---|---|---|
| **P** | production proof `684534d2…` | the DEPLOYED `design-panel-ai-generate` edge |
| **A** | production proof `684534d2…` | the harness |
| **B** | neutral-field variant `268fa273…` | the harness |

P and A are the SAME condition drawn twice, deliberately: Call 1 pins no
temperature, so one image per arm cannot separate an effect from sampling noise.

**Request parity, measured.** Five parts; per-part sha256 identical at indices
0, 1, 3, 4 and different only at index 2, the teaching image. Prompt 4,587 chars
in both arms. The harness request is byte-size identical to the deployed edge's
own `modelRequestByteSize` (4,762,109), `modelInputImageCount` (2) and model —
asserted before either experimental call was spent.

**Variant integrity.** 456,178 background pixels recoloured (29.0% of canvas);
**0** pixels changed inside any panel rectangle; **0** pixels changed that were
not near-black; 8,396 dark artwork pixels preserved inside the panels.

## Result — `edgeHoleRatio`, raw pre-repair (blocking threshold 0.35)

| arm | driver | passenger | front | hood | rear | roof |
|---|---|---|---|---|---|---|
| **P** | 0.004 | 0.005 | **0.374** | 0.000 | **0.447** | 0.000 |
| **A** | 0.000 | 0.000 | 0.000 | 0.000 | **0.936** | 0.334 |
| **B** | **0.909** | **0.909** | 0.302 | **0.505** | **0.611** | **0.637** |

Largest single dark component, share of zone:

| arm | driver | passenger | front | hood | rear | roof |
|---|---|---|---|---|---|---|
| **P** | 0.0% | 0.0% | 11.6% | 0.0% | 2.8% | 0.0% |
| **A** | 0.0% | 0.0% | 0.0% | 0.0% | 7.4% | 11.2% |
| **B** | **23.3%** | **23.0%** | 3.0% | **29.0%** | **25.9%** | 11.1% |

`flatBlackRatio` — B driver 48.8%, B passenger 48.8%, against 0.0% in both
control arms.

## What it says

1. **The black field is not the cause.** The hypothesis predicted that removing
   it would reduce the flank holes. It produced them: driver and passenger went
   from ~0.00 in both controls to 0.909 in the variant, with 48.8% of each flank
   painted near-black.
2. **The variant's own output is still black-backgrounded.** Teaching the model
   a neutral field did not make it paint a neutral field. Whatever selects the
   black surround, it is not copied from the example's field colour.
3. **P↔A variance is larger than any effect this test could have measured.**
   Same request, two draws: P failed front + rear, A failed rear + roof, and the
   flanks were clean in both. The output CLASS also changed between them — P is
   a photoreal vehicle depiction with grille, glass, handles and arches; A is
   six flat rectangles. On this fixture the deployed conditioning does not have
   a stable output class, and which surface fails is close to a coin flip.
4. **All three masters failed the deterministic gate.** `accepted=false` on P, A
   and B. The gate is doing its job; the conditioning is not.
5. **The gestalt the model copies is "discrete panels floating on a field", not
   the field's colour.** B rendered die-cut body shapes — wheel arches and window
   openings punched out, door seams drawn — which is what the separation gaps
   teach, and they are unchanged between arms by construction.

## What this does NOT license

No production change. The production teaching proof, its edge-function hash pin,
the prompt, the topology, the neutral guide and the repair path are all unchanged
by this run and stay that way. One ambiguous sample is not a reason to touch a
pinned owner artifact — and this sample is not even ambiguous in the variant's
favour.

## Next isolated variable

The owner's pre-agreed Test 2: **the neutral target guide**, confirmed by this
run's own captured request to be part 4 — the final image, 137,010 bytes,
`7c10d6ae…`, identical in both arms. CLAUDE.md's v19 list saying it is not sent
is stale; the assembled request proves it is.

Given finding 3, Test 2 needs more than one draw per arm to say anything. The
control variance on this fixture spans a whole output class, so a single pair
cannot resolve an effect smaller than that.
