# CLAUDE.md — designproai-os

## 🟢 RULE 0.33 — ONE-FIELD CALL 1 IS THE PRODUCT (owner ruling, Trish 2026-09-02 — "UNFREEZE GET ME A WORKING OS")

**Supersedes the authoring half of v19, v23, RULE 0.30's conditioning clause,
RULE 0.28 §2 and every earlier "teaching proof / neutral guide / topology
text" input rule below wherever they conflict.** The gates are untouched.

Gemini authors **ONE uninterrupted full-bleed vehicle-wrap composition** and is
shown **no production topology**: no six-region guide, no labeled Flamingo
teaching sheet, no normalized `[0,1]` text, no six named production objects,
no panel/artboard/template framing, no wheel/window/body-piece negatives. The
model request is **one text part plus verified customer references**.
GENIE/runtime owns Driver, Passenger, Hood, Roof, Front and Rear as **code-only
territories** (`runtime/atlas-field-territories.cjs`, `field-thirds-v2`) and
cuts them AFTER the one image call. Passenger is its own territory, never
mirrored Driver.

Why: the live v23 generation `84a3eadf…` (2026-09-02, the GENIE-prep
validation run) passed every gate and still painted wheel arches and body lines
into both flanks, an inverted rear and a mirrored passenger. Field Recovery v2
draw `33659500846` is the only measured configuration with clean, continuous,
anatomy-free flanks, so it is the product now. The edge assembly emits that
harness prompt **byte for byte** for its fixture (`37e4137e8ae8c8bb…`) while
the legacy six-container branch still emits the deployed v23 pin — locked by
`tests/atlas-one-field-call1.test.mjs`. Full contract:
`docs/ATLAS-ONE-FIELD-CALL1.md`. Versions
`designpro-flat-first-atlas-20260902.v24-one-field` /
`atlas-artboard-designiq.20260902.v24-one-field`.

**The thirds language in the tail is scaffolding the owner has not approved as
permanent architecture.** Draw 1 drew the thirds as framed passages with thin
white margins inside the bleed insets. That is the next creative variable to
measure on a real product generation, not a reason to re-add containers,
guides, teaching sheets or negatives.

## 📐 RULE 0.32 — A.T.L.A.S. IS PRINTED MEDIA, NOT A VEHICLE (owner ruling, Trish 2026-09-02)

**A.T.L.A.S. = the continuous printed wrap sheets, unwrapped flat, BEFORE
installation and trimming.**

This is the governing definition. Where any other section of this file describes
A.T.L.A.S. in terms of vehicle panels, body layout or "the flattened panel
layout of the vehicle", THIS WINS.

Owner, from the Avery Dennison installation reference (*Wrapping the Side of a
Vehicle with one Panel*): a Driver/Passenger print panel is **ONE CONTINUOUS
RECTANGULAR SHEET OF PRINTED VINYL BEFORE INSTALLATION**. The artwork prints
continuously through the physical location of the wheel opening. The installer
lays that continuous sheet onto the vehicle and trims the opening **during
installation**.

Therefore, for every A.T.L.A.S. surface:

> **the entire rectangular region is printable artwork.**

**Vehicle anatomy has no authority over the shape of the print artwork.** A wheel
opening, window, fender, door seam, glass area, light, handle or any other
physical vehicle feature must NEVER become missing artwork inside the rectangular
A.T.L.A.S. panel. The vehicle is where the media goes; it is not what the media
looks like.

### The acceptance contract

Not "no black pixels" — that is a proxy, and a colour-conditional one:

> **SIX CONTINUOUS RECTANGULAR ARTWORK REGIONS, EDGE TO EDGE, WITH NO
> MISSING-ARTWORK FIELDS OR VEHICLE-ANATOMY CONTOURS.**

A missing-artwork field is a missing-artwork field whatever colour it is. Measured
2026-09-02 on GenerationID `5d727ea9`: `cutoutFillApplied` reported 303,861 px
closed on the driver flank with `unresolvedPixels: 0`, and by the gate's own
near-black predicate only **22 px** survived — while **7.55% of that flank was
still one uniform non-artwork field**, visually a solid black wheel well.
`FLAT_BLACK_CHANNEL_MAX` is 24 and the filled disc measures ~`rgb(25,19,23)`. The
fill moved the defect one value on one channel out of the only predicate watching
it, and every downstream check keys on that same predicate. **Turning a
missing-artwork field into nearly-black pixels is not repair, and must not make an
invalid master canonical.**

### The objective is FIRST-ATTEMPT correct authoring

Owner, verbatim: *"I do not want the architecture to become: Gemini draws wheel
hole → reject → ask Gemini again → hope. I want: Gemini understands A.T.L.A.S. as
continuous rectangular printed media → produces continuous artwork first
attempt."*

A re-roll is a **failsafe, not the root-cause fix**. A large missing-artwork
region may ultimately fail closed as a safety measure, and small genuine edge
defects may retain the proven deterministic repair — **those are safeguards.**

**Until the conditioning root cause is identified by controlled experiment, do
NOT:** add wheel-well negative prompting · add another repair heuristic · relax a
threshold · change the DesignPanelAI creative intelligence · deploy re-roll as the
fix.

### What is established, and what is not

| established by measurement | still open |
|---|---|
| DesignPanelAI can produce excellent cohesive A.T.L.A.S. artwork (`5d727ea9`) | which Call-1 input teaches vehicle-body-piece interpretation |
| deterministic panel extraction is correct | first-attempt output-class stability |
| the wheel/glass voids originate in Gemini Call 1, painted opaque (`opaqueRatio` 1.00000) | |
| large-hole repair cannot recreate artwork Gemini never generated | |
| Call-1 output class is unstable — the SAME request returned `flat_atlas` 3/3 and `vehicle_depiction` 3/3 an hour apart | |

Investigation record: `docs/ATLAS-TEACHING-PROOF-FIELD-AB.md`,
`docs/ATLAS-CALL1-GUIDE-ABLATION.md`, `docs/ATLAS-CALL1-TOPOLOGY-TEXT.md`,
`docs/ATLAS-CALL1-TEACHING-PROOF-ORDER.md`, `docs/ATLAS-WHEEL-WELL-ROOT-CAUSE.md`,
raw evidence under `docs/ab/`.

## 🧞 GENIE PREP LIFECYCLE + MANIFEST HASH v2 (owner ruling, Trish 2026-09-02)

**GENIE knows dimensions before DesignPanelAI generates.** Vehicle complete / Enter → the browser posts its
GenerationID + vehicle → the server acknowledges, records `designpro_genie_preps` keyed by (generationId,
vehicleIdentityHash, genieContractVersion) and runs `resolveFlatAtlasPreviewDimensions` while the customer
writes. Generate consumes a READY prep for the exact owner + GenerationID + vehicle identity + contract;
anything else runs the inline resolver exactly as before. **Prepared geometry is private OS state and never
enters the model-facing request** (locked). `docs/GENIE-PREP-LIFECYCLE.md`; the trace that located the
defect: `docs/GENIE-LIFECYCLE-TRACE-2026-09-02.md`.

**Manifest hash v2.** v1 hashed `null` for every surface, so `genieManifestHash` never varied with the
inches (every 2026-09-02 draw reported `879291d3…`). v2 (`designpro.genie-manifest.v2`, explicit
`hashContract: designpro.genie-manifest-hash.v2`) hashes the six surfaces. Historical rows are NOT
rewritten: `docs/GENIE-MANIFEST-HASH-CUTOVER.md`, locked by `tests/genie-manifest-hash.test.mjs`.

**DEPLOYED-VERIFIED 2026-09-02 on `24a8b446` through the real intake at os.designproai.com**
(`docs/GENIE-PREP-LIVE-VALIDATION-2026-09-02.md`): Enter → prep READY in 78 ms resolver time, zero
provider calls; vehicle change mints a new GenerationID (stale prep unreadable by construction) and the
same-GenerationID RPC path marks the old row `superseded` and the worker reclaims the queued one;
Generate on GenerationID `84a3eadf…` consumed prep `a377be67…` (`prepHit: true`, `genieMs: 67`, inline
resolver skipped, manifest hash `766258a0…` identical on prep and revision) and the unchanged v23 Call-1
request produced master `1564c66d…`, six panels, seven views, Calls 8–11 and `pack.activate` in 3 m 49 s.
Creative defects seen on that master (wheel-arch/body-line drawing, inverted rear, mirrored passenger)
are the frozen conditioning question, not the lifecycle.

## 🧬 CALL-1 v19 — CREATIVE PARITY RECOVERY (owner ruling, Trish 2026-09-01)

**This supersedes the v17 boundary contract and RULE 0.30's authoring half
below, on every point where they conflict.** It is the result of an executed
parity diff, not a theory: both prompt builders were run against one identical
fixture (DID-2D918868's own stored `request_input`) at eleven commits.

### What the measurement found

The creative regression was never `7ee1f868`. Creative conditioning held at
**exactly 2,490 characters** from the last near-working master
(**DID-2D918868**, GEN `2d918868-44e9-4121-9a72-3fbbfc85ff33`, 2026-08-27
10:18:04Z, source `36e5acc4` — the only commit carrying both version strings
that revision recorded) through 08-28. Then:

| commit | date UTC | creative chars | what it did |
|---|---|---|---|
| `36e5acc4` | 08-27 04:14 | **2,490** | the known-good state |
| **`c5479313`** | **08-30 22:12** | **2,025** | **deleted 465 chars of proven creative direction** |
| `334c79f0` | 09-01 03:08 | 2,394 | still 96 short; format/refusal text up 54% |

`c5479313` ("Isolate A.T.L.A.S. Call 1 to neutral topology masks") is the
six-field-livery anonymization. RULE 0.0 later reversed its vocabulary but
never restored its deleted text. It removed: the customer-selected **finish
spec**; *"with real dimension rather than flat shapes on bare panel"*;
*"never an on-vehicle photograph"*; and three persona anchors — *"installed on
real trucks and vans"*, *"readable at a glance from across a parking lot"*,
*"worth what the customer paid"*.

**Rewriting creative framing to fix a pixel defect is what RULE 0.1 forbids,
and it is what happened here.** Four subsequent releases each added more
format and refusal language on top of the loss.

### The Call-1 request, as of v19

1. the DPAG creative assembly, with `36e5acc4`'s language restored;
2. the **MANDATORY OWNER-APPROVED LABELED FLAMINGO A.T.L.A.S. TEACHING PROOF**
   — exact owner bytes, SHA-256
   `684534d27f8e7d70771f4931d9d1119ec73d2a28db774abcc4e343eb6e5e3ded`
   (3,430,273 bytes, 1254×1254 PNG, contract
   `designpro.atlas-labeled-teaching-proof.v3`). Verified byte-identical to
   the owner's copy. Never recreate, repair, crop, relabel or re-encode it;
3. verified customer references, if any.

Two text parts, one teaching image, customer references. That is the whole
request.

**NOT sent, and not to be restored without owner approval and evidence:**

- the **normalized `[0,1]` topology table**. GENIE and the runtime keep full
  mathematical authority — `manifest.zones`, `normalizedZoneTopology` and the
  request-body `normalized` field are unchanged and still validated — but the
  OS owning the math does not require Gemini to consume it. Layout reaches the
  model as the prompt's named panel list, which is how the proven RestylePro
  `mode:'artboard'` call has always worked;
- the **blank neutral guide / container image**. A blank canvas handed to an
  image model reads as content to interpret;
- the **Houdini flat/3D teaching pair**;
- the authoring-side **`OUTPUT CLASS — ABSOLUTE`** refusal block. See below;
- an explicit **`temperature`**. DID-2D918868 sent no temperature field, so
  Gemini applied its own default; `7ee1f868` pinned 1.0 on the same commit
  that changed six other things and it has never been isolated. Parity
  recovery does not introduce even a plausible config difference.

### The gate stays; its words do not

RULE 0.30's post-generation output-class gate is **unchanged and still
blocking** — `classifyAtlasCandidate`, `runtime/atlas-output-class.cjs`,
`masterOutputClass`. It runs after generation and cannot affect design pixels;
it only decides whether bad output may become canonical. The same words
injected into the *authoring* prompt are a long negative that displaces
creative direction and makes the model over-index on the forbidden thing, so
they are removed from Call 1's conditioning. **A post-generation gate cannot
reduce creative quality. Authoring conditioning can.**

### The finish comes from the customer, never from a release

Gloss / Matte / Satin / Chrome / Brushed arrives on the request
(`input.finish` → `atlasEdgeRequestBody` → `body.finish`) and selects its text
from the shared `FINISH_SPECS` table exactly as it always has. **That table is
not edited and no finish is pinned.** `atlasFinishSpec()` applies two flat-
master-only adjustments: it stops the caller prefixing a label the table
already opens with (`Finish: GLOSS — GLOSS — …`), and it rewrites the two
entries that describe sheen landing on physical *body panels* — vehicle
anatomy Call 1 must never be taught. Calls 2–8 keep the pinned wording
verbatim, because a body panel is exactly what the photographer photographs.

### Call 1 designs; Calls 2–8 present. Verified from code.

- **A.T.L.A.S. proofs** are rendered by **`persona-photographer-render`**
  (`ATLAS_PROOF_STAGE`, `runtime/designpanel-server-provider.cjs:1052`) in
  `mode: "atlas-proof"`. **Standard** proofs use `generate-color-render`
  (`designpanel-edge-provider.cjs`). Both names in the history are real; they
  are two different pipelines and neither replaces the other.
- The proof request carries `sourcePanelStoragePath` + `sourcePanelHash` +
  `sourceMasterHash`, resolved per shot by `panelFor()` → `surfaceForProofView`.
  The edge **refuses rather than renders** on mismatch:
  `atlas_proof_surface_mismatch` and `atlas_proof_panel_hash_mismatch`. The
  selected finish rides through, so it stays consistent across Call 1 and the
  proofs.

Prompt versions: runtime `designpro-flat-first-atlas-20260901.v19-creative-parity-recovery`,
edge `atlas-artboard-designiq.20260901.v19-creative-parity-recovery`.

**Do not re-add creative conditioning to fix a pixel defect.** If a master
comes back wrong, the gate refuses it; diagnose the input contract, not the
creative language. Locked by `tests/designpro-persona-contract.test.mjs`,
`tests/atlas-artboard-edge-call1.test.mjs`,
`tests/atlas-clean-authoring-contract.test.mjs`,
`tests/atlas-cohesion-teaching-pair.test.mjs`,
`tests/atlas-output-class-gate.test.mjs`.

## 🧭 SUPERSEDED — CALL-1 v17 BOUNDARY CONTRACT (kept for history)

The owner's Call-1 boundary contract supersedes the v15/v16 teaching-input
wording below wherever they conflict. The Call-1 model request is exactly:

1. the DPAG creative assembly (unchanged);
2. the **GENIE-derived normalized `[0,1]` mathematical topology** — a text part
   (`surface | x | y | width | height | orientation`, four decimals, computed
   from `manifest.zones`; contract `designpro.atlas-normalized-topology.v1`).
   It is the SOLE target-vehicle geometry/proportion authority;
3. the **MANDATORY OWNER-APPROVED LABELED FLAMINGO A.T.L.A.S. TEACHING PROOF**
   — exact owner bytes, SHA-256
   `684534d27f8e7d70771f4931d9d1119ec73d2a28db774abcc4e343eb6e5e3ded`
   (3,430,273 bytes, 1254×1254 PNG,
   `runtime/atlas-examples/flamingo-labeled-atlas-teaching-proof.png`,
   contract `designpro.atlas-labeled-teaching-proof.v3`). Its labels establish
   panel identity ONLY; its arrangement is NOT target geometry; never
   recreate, repair, crop, relabel or re-encode it;
4. verified customer references, if any.

**NO blank neutral target-guide image** (suspected conditioning regression —
do not restore it), **NO correctiveNote** on any attempt, `temperature: 1.0`
pinned, `gemini-3-pro-image`, `1:1`, native `4K`, exactly ONE image request.
Prompt versions: runtime `designpro-flat-first-atlas-20260901.v17-labeled-teaching-topology`,
edge `atlas-artboard-designiq.20260901.v17-labeled-teaching-topology`. The
superseded unlabeled "repaired flat cohesion example" (`20085eb5…`) must not
reach Call 1. Locked by `tests/atlas-cohesion-teaching-pair.test.mjs`,
`tests/atlas-artboard-edge-call1.test.mjs`,
`tests/atlas-clean-authoring-contract.test.mjs`,
`tests/atlas-designiq-artboard.test.mjs`.

## 🎯 RULE 0.30 — CALL 1 IS A.T.L.A.S. AUTHORITY ONLY (owner ruling, Trish 2026-09-01)

Owner, verbatim: **"The only valid Call-1 image output is ONE flat A.T.L.A.S.
panel-layout source containing ONE cohesive vehicle wrap unwrapped flat. Any
installed vehicle, 3D vehicle, vehicle montage, presentation board, camera
view, studio render, or mockup is categorically invalid at Call 1. The 3D
presentation system exists downstream and has zero authority over Call 1. Do
not allow any Call-1 candidate that is not A.T.L.A.S. to become canonical or
fan out downstream."**

Why it exists: DCA generation `470cb0e9` (v17, 2026-09-01) proved Gemini can
answer the approved request with a photoreal vehicle-mockup montage (edge
master `6200fd41…`) that passes EVERY deterministic structural gate — those
gates convict silhouettes/voids/template leakage, and a bright render measures
as 94%+ "artwork" — after which the six canonical panels faithfully cut
pictures of a van. Provenance proved the montage bytes were authored directly
by Call 1 (`atlas-call1/aba7fbbf….png`, hash-equal to the edge `masterSha256`,
written before any proof existed), so the fix is Call-1 conditioning +
blocking acceptance, never artifact-authority wiring.

Enforced twice (prompt version `…20260901.v18-atlas-output-class`):
1. **Conditioning** — the flat-master contract carries "OUTPUT CLASS —
   ABSOLUTE"; both authoring scenes bind the output to the teaching example's
   object class.
2. **`runtime/atlas-output-class.cjs`** — one binary Gemini class question
   (temp 0, `gemini-2.5-flash`) inside the authoring gate, AFTER deterministic
   checks and BEFORE acceptance. An explicit `vehicle_depiction` verdict fails
   CLOSED (`flat_atlas_master_output_class_invalid`, re-roll within the
   bounded budget, never canonical, never fans out). Inspector transport
   failure fails OPEN with a durable `unavailable` receipt
   (`metadata.masterOutputClass`) — an outage must not brick authoring, and
   this is the ONE semantic question allowed to refuse Call 1; all other
   semantic review remains advisory. Locked by
   `tests/atlas-output-class-gate.test.mjs` and
   `tests/atlas-repair-before-reroll.test.mjs`.

## 📋 DCA PHASE 1 — CURRENT STATUS BOARD (2026-08-31, release `5d3ad9b`)

**This is a status board, not a rule.** It records what is true right now so a
session does not re-derive it, and so nothing gets reported as proven that a
live generation has not actually proven. Every rule below still governs.

**Three evidence levels are used, and they are not interchangeable:**

| level | means |
|---|---|
| **DEPLOYED-VERIFIED** | read back off the running system this session (deployed edge-function body hashed against the branch, live DB row, workflow log) |
| **CODE-LOCKED** | in the release and covered by a named test that was verified to fail against the defect it describes — but no fresh live generation has exercised it |
| **OPEN** | not done, not proven, or deferred |

### Release / deployment state

- Droplet (web, gateway, runtime) is on `37c4807`, deploy run `33433458730`,
  `Deployed web, gateway, and two exact-SHA DesignPro runtime replicas`,
  2026-08-31 20:02:34Z. `ops/deploy.sh` switches the `public` pointer after
  acceptance and exits 12 if it does not land, and Caddy roots
  `designproai.com` at `/opt/designproai-os/public/web/dist`, so that pointer
  IS the public path. "Caddy, DNS, and public traffic were not changed" in the
  log means the ROUTING CONFIG was untouched, not that the release is dark.
- `deploy-production.yml` does **not** ship Supabase edge functions. They are a
  separate dispatch-only workflow (`deploy-edge-functions.yml`). On 2026-08-31
  `persona-photographer-render` was found three days stale on the live project,
  missing the pickup-bed clause from PR #278; redeployed as v17 and verified
  byte-identical. **Check both halves before calling a SHA deployed.**
- `5d3ad9b` (the GENIE ambiguity retry) is merged and deploying at the time of
  writing. It is NOT yet deployment-verified.

### Contract and authority status

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Call 1 A.T.L.A.S. is the SOLE creative authority | **DEPLOYED-VERIFIED** | deployed `design-panel-ai-generate` index.ts hashes `a5b3c1e850d7eca4`, byte-identical to the branch; `tests/atlas-sole-design-authority.test.mjs` |
| 2 | Mandatory Flamingo FLAT teaching example pinned in the live Call-1 edge path | **DEPLOYED-VERIFIED** | SHA-256 `20085eb547251d46c8113014108b088e35a4d41e2ce77b9a152b2786e79c37fa` present in the deployed body; prompt version `atlas-artboard-designiq.20260831.v15-flat-example-only`. The installed Flamingo proof is NOT attached (canary `33389124918`) |
| 3 | DesignPanelAI Commercial/ReStyle persona + edge stack preserved | **DEPLOYED-VERIFIED** | all 11 shared deps of `design-panel-ai-generate` match the branch; RULE 0.29 pins verified live — `persona-photographer-prompt.ts` `11cb76524211e42a`, `view-angles-os.ts` `8890be50c124a2c5`, `studio-os.ts` `7b02814bb1e9e867` |
| 4 | Raw Gemini can STILL return silhouette / black-surround invalid A.T.L.A.S. output | **OPEN — by design** | unchanged model behaviour. `normalizeAtlasMaster` only resizes and masks gutters, so it cannot introduce in-zone black: the contract is first violated at the raw Gemini output. This is now CAUGHT, not prevented |
| 5 | `edgeHoleRatio` blocking acceptance gate | **CODE-LOCKED** | `runtime/atlas-master-qc.cjs`, `MAX_ZONE_EDGE_HOLE_RATIO = 0.35`; commit `cf36b0b`, shipped in `37c4807`. Closes the hole where `edgeOpaqueRatio` measured ALPHA and a silhouette on black scored 1.00000. Fixtures in `tests/atlas-master-qc.test.mjs` |
| 6 | Structural POST-REPAIR re-validation | **CODE-LOCKED** | `flat_atlas_repaired_master_invalid` in `runtime/flat-first-atlas.cjs`, commit `dbcb051`. Determinism proves a repair is repeatable, not that its result is valid |
| 7 | Post-repair validated bytes BECOME the canonical accepted master | **CODE-LOCKED** | `acceptedMasterBytes` / `acceptedMasterHash`; `tests/atlas-accepted-master-is-the-repaired-one.test.mjs`. Promotion happens only AFTER re-validation passes. Clean masters are byte-identical and pay no extra transform |
| 8 | `preRepairMasterHash` is PROVENANCE ONLY | **CODE-LOCKED** | same commit and test; it may never again be called canonical, accepted, or what "Master QC passed" refers to |
| 9 | All six Call-1 panels bind `sourceMasterHash` to the ACCEPTED master hash | **CODE-LOCKED** | `cutCallOnePanels(surfaceSourceBytes, manifest, acceptedMasterHash, …)` and `sourceMasterHash: acceptedMasterHash`, both asserted. **Not yet proven by a fresh live generation** |
| 10 | PanelPro / RevisionStudio display the ACCEPTED master and panels, never pre-repair authority | **CODE-LOCKED** | the published root carries `contentHash: acceptedMasterHash`; revision row records it. **Not yet proven by a fresh live generation** |
| 11 | Exactly six canonical surfaces | **CODE-LOCKED** | `SURFACE_KEYS = ["driver","passenger","hood","roof","front","rear"]`, frozen, `runtime/flat-first-atlas.cjs:98`. Front is the bumper/fascia surface |
| 12 | No downstream AI panel producer; Call 9 is verification/promotion only | **CODE-LOCKED** | RULE 0.25; Call 9 creates no artwork and changes no bytes |
| 13 | Customer 2D Proof and internal 2D Production Proof are SIBLING BRANCHES and may not gate panel publication | **CODE-LOCKED** | `docs/ATLAS_ONE_ARTIFACT_GRAPH.md` §7B (PR #278). Call 1 streams panels per cut and builds each proof authority the instant its panel exists; `proof.build` sits after the panel and logo branches. No barrier to remove |
| 14 | Server-owned orchestration required; browser becomes observer-only | **OPEN** | standing requirement, not fully proven |
| 15 | False-serialization audit | **OPEN** | remains open wherever not completed |
| 16 | GENIE `genie_grounding_ambiguous` corrective re-ask | **CODE-LOCKED, DEPLOY IN FLIGHT** | `fd4a35e`, merged as `5d3ad9b` (PR #280). Both new failure tests verified to fail against the pre-fix resolver |
| 17 | Fresh DCA must verify the PERSISTED vehicle payload before any GENIE/A.T.L.A.S. work | **OPEN — required next** | the 2026-08-31 20:09:20Z failure stored `model: "F150"`; do not assume user error. Read `request_input->'vehicle'` and compare to what was typed BEFORE proceeding |
| 18 | Input contract drops cab/bed configuration | **OPEN — backlog, NOT this release** | `designpro.calls-1-7-input.v3` carries only `make`/`type`/`year`/`model`. Configuration-critical for F-series: the catalog's own 2008-2010 rows put Crew Cab Long Box at 251″ and Crew Cab Short Box at 234″. Do NOT widen the contract unless a fresh DCA proves it blocks progress |
| 19 | 2022 F-series geometry is PROVISIONAL / grounded estimation | **DEPLOYED-VERIFIED (data)** | the whole Ford catalog has 5 rows covering 2022 and all five are Transit vans. Every F-150 row ends 2020, every F-250 row ends 2016. Report such runs as estimated/provisional, never catalog-authoritative |
| 20 | Creative design-quality tuning | **DEFERRED** | deferred until DCA Phase 1 is complete. Do not start it from a documentation pass |

### CURRENT DCA CHECKLIST

**Leave every box unchecked until a FRESH live generation proves it.** Nothing
below is checked, because no DCA has completed on this release.

- [ ] Fresh DCA submitted on the deployed release; build SHA confirmed in the footer
- [ ] Persisted `request_input.vehicle` matches exactly what the owner typed
- [ ] GENIE resolves without `genie_grounding_ambiguous`
- [ ] Geometry source reported honestly (catalog-authoritative vs grounded/provisional), with the resolved `sub_type` named
- [ ] Call 1 executes exactly once and returns a master
- [ ] Deterministic master checks report per-surface measurements
- [ ] Repair ran / did not run — recorded either way
- [ ] `preRepairMasterHash` recorded when repair changed the source, null when it did not
- [ ] Accepted canonical master hash + storage path recorded
- [ ] Six Call-1 panel hashes recorded
- [ ] All six `sourceMasterHash` values equal the accepted canonical master hash
- [ ] Six surface identities correct: Driver, Passenger, Hood, Roof, Front, Rear
- [ ] A.T.L.A.S. master published to PanelProStudio and RevisionStudio, showing the ACCEPTED sheet
- [ ] Progressive panel publication timing recorded
- [ ] Driver proof first, then the remaining six concurrently; fan-out timing recorded
- [ ] Owner visual inspection at PanelProStudio: master → six clean panels → matching 3D proofs
- [ ] **STOP HERE.** No Full QC and no creative changes until the owner approves those artifacts

**If Call 1 refuses the master:** report the exact structural rejection and the
per-surface measurements. Do not work around it and do not change conditioning.

## 🗺️ RULE 0.0 — A.T.L.A.S. IS ONE VEHICLE-WRAP DESIGN, NOT SIX ANONYMOUS DESIGNS. (Trish 2026-08-31)

This owner correction supersedes any later historical wording in this file
that tells Call 1 to hide the target vehicle, replace named surfaces with
anonymous `FIELD A–F` language, or treat its six regions as generic livery
canvases.

**A.T.L.A.S. means one cohesive vehicle-wrap design arranged flat as six named
printable production surfaces for one exact target vehicle.** The vehicle is
design and installation context; Call-1 output pixels are not a vehicle
photograph, rendering, silhouette or anatomy drawing. Driver, Passenger, Hood,
Roof, Front and Rear are coordinated rectangular surfaces of one composition,
never six independent creative prompts.

The image model receives the server-resolved year/make/model, GENIE body class,
the named surface mapping and coverage context it needs to design for the
installed vehicle. GENIE/code remains the geometry authority. Numerical
dimensions and installer geometry never become printable prompt furniture.

For pickups, exterior bed sides and tailgate receive the coordinated artwork;
the bed floor and inner bed walls remain unwrapped under the downstream vehicle
application/proof coverage contract. Do not claim a dedicated bed contour mask
exists unless a durable contract and artifact prove it. That exclusion never
punches a hole into Call 1: all six source panels remain pure, opaque,
uninterrupted, full-bleed rectangles.

Call 1 accepts and durably binds the master plus the six canonical panel files.
Separating those exact rectangles is deterministic byte handling, not a later
creative extraction. Both the master and all six Call-1 panels publish to
PanelProStudio immediately after Call-1 acceptance. Call 9 only re-reads,
hash-verifies and promotes those unchanged bytes; it is never their creator and
never their first UI publication boundary.

The quality baseline remains the proven DesignPanelAI vehicle-wrap designer
persona and its populated structured inputs. Call 1 receives one hash-pinned,
owner-approved **flat Flamingo A.T.L.A.S. example** plus the neutral target
guide. An installed/3D vehicle proof is not a Call-1 teaching input: production
canary `33389124918` proved that the finished-vehicle image overpowered the
flat-source instructions and leaked vehicle/template anatomy into the canonical
rectangles. The flat example is reference-only and may not contribute customer
artwork, branding or production authority. Do not silently restore a
stylistically or structurally contaminating installed example.

## 🎯 RULE 0.1 — TWO SEPARATE GOLD STANDARDS. DO NOT MIX THEM. (Trish 2026-08-17)

Design quality and output-pipeline correctness are judged against **different
references**. Conflating them is how a good hero render got read as "the
pipeline works", and how a working July-24 pipeline got read as "the designs
are fine".

| Layer | Gold standard | Judge |
|---|---|---|
| **Design quality / generation behaviour** | the proven pre-regression DesignPanelAI production body of work (including Flamingo Pools, the commercial fleet gallery and owner-identified strong designs) | is one vehicle-specific design premium, cohesive and consistent across its six surfaces and presentation descendants |
| **Output / production pipeline** | the **July 24** working state, `docs/LAST-WORKING-STATE-2026-07-24.md` | does the chain still produce the artifacts it produced then |

The distressed Martini Porsche used a customer-requested one-off camera angle.
Neither that angle nor an aspect-ratio change is the regression being diagnosed.
Do not turn either into a new global design contract. Do not use July 24 alone
to judge current design-generation quality.

The July-24 flow is a **regression target**, not a redesign brief:

> design approved → automatic 2D Production Proof → six correct production
> sides → RevisionStudio paired 3D render + 2D production panel per side →
> Production Layers → production pack / output path.

**If July 24 proves the architecture already worked, do not redesign it.**
Identify the smallest wiring/contract difference between then and now, and
replace only components proven defective.

### Judge the seven-view run at the artifact level, not "looks good"

A visual impression cannot tell you whether a weak design means the port is
incomplete or the inputs were empty. Record, for all seven views:

`prompt hash · prompt length · model · studio contract version ·
view-angle contract version · structured inputs actually populated ·
whether branding/phone/logo fields were present · retries · image hash`

Then the diagnosis is mechanical rather than aesthetic:

- **The accepted flattened A.T.L.A.S. is weak or internally inconsistent** →
  parity-diff Call 1 first: exact prompt, designer persona, canonical vehicle,
  body class, named surface relationships, customer fields, references and
  hashes. A short prompt or unpopulated structured inputs means the Call-1 port
  or caller is incomplete.
- **The accepted A.T.L.A.S. is cohesive but a presentation descendant drifts** →
  trace only that view's `persona-photographer-render` / angle / surface-panel
  input. `generate-color-render` is historical presentation behavior, not a
  substitute creative authority and not an automatic diagnosis.

**Do not touch Calls 8+ during that determination.**

Once the seven-view layer is proven, switch models back to July-24 regression
for output. The question there is not "how should the pipeline work" — it is
**"what exact wiring or state difference stops today's system behaving like
July 24?"** Keeping the front-half and back-half investigations separate is
what stops the output path being treated as greenfield again.

**Where the proven quality came from.** The production body of work used
`design-panel-ai-generate` with its vehicle-wrap designer persona and populated
structured brief inputs. Studio and angle contracts governed the 3D
presentation descendants. A weak accepted flattened master is therefore a
Call-1 conditioning/input regression; a correct master with one drifting view
is a presentation-projection regression. Keep those diagnoses separate.

## 🛞 RULE 0.15 — A WRAP PANEL IS A SOLID RECTANGLE. THE INSTALLER CUTS THE HOLES. (Trish 2026-08-23)

**Every A.T.L.A.S. zone, every canonical Call-1 panel, every print file is one solid
rectangle of continuous artwork, opaque corner to corner.** The design runs
straight through the places a windshield, side window, door glass, wheel arch,
tyre, pickup-bed opening, light, handle or trim will later sit.

**The installer cuts the wheel opening and the window out of the finished
panel.** That is why the artwork has to exist there — there is nothing to cut
otherwise, and a hole in the master prints as a hole in the vinyl.

A zone that comes back as a *picture of a vehicle* — a silhouette with wheel
circles and glass shapes punched through it — is a failed master, not a stylistic
choice, **even when the hole is filled with flat colour.**

Live evidence, 2026-08-23 (Becky's Bakery, Chevy Transit Connect): the master
returned a van silhouette with black wheels and black glass, and *every*
deterministic check reported pass — because `opaqueRatio` only asks whether a
pixel is opaque, and black is opaque. Two things now stop it:

- **`runtime/flat-first-atlas.cjs`** states the rule positively (SOLID PANELS),
  because negatives make Gemini over-index on the forbidden thing. `PROMPT_VERSION`
  is `designpro-flat-first-atlas-20260831.v16-flat-example-only`; older masters are refused for
  NEW authoring/regeneration only, never migrated — and never hidden: existing
  generations stay readable/viewable/downloadable on every read surface
  (owner protection #1, locked by `tests/atlas-historical-read.test.mjs`).

  **REFERENCE STATUS CORRECTION (2026-08-31, after production canary
  `33389124918`).** The earlier installed↔flat teaching pair is historical and
  must not be sent to Call 1. The accepted master under GenerationID
  `083d2a70-edac-4e75-9caa-1336542baf7c` preserved wheel-well shapes, white
  guide/gutter bands and template furniture even though it passed the older
  deterministic gates. Request inspection proved that the installed Flamingo
  Driver proof was the strongest visual instruction and reintroduced the
  anatomy that source rectangles must exclude.

  Call 1 therefore presents the release-pinned, pure-rectangle Flamingo flat
  teaching example (SHA-256
  `20085eb547251d46c8113014108b088e35a4d41e2ce77b9a152b2786e79c37fa`)
  before verified customer references, then presents the current neutral
  target guide last. The historical GenerationID remains
  `5b2eb96c-77b5-4705-8cad-fef00af677fe`; its installed proof remains useful as
  historical/presentation evidence but is not attached to Call 1. Surface
  names and IDs remain server metadata and prompt mapping only. They must never
  appear as labels, captions, legends, headers or printable pixels. The
  historical Houdini pair stays dormant.

  **An A.T.L.A.S. master is one flat production atlas FOR a vehicle wrap.**
  Canonical YMM, GENIE body class and the six named surfaces reach the prompt as
  design context. The returned pixels remain six pure printable rectangles and
  carry no vehicle photograph, outline, anatomy, wheel, window, seam, void or
  shaped opening. Numeric geometry, coverage and production dimensions remain
  code/GENIE authority. Hiding all physical meaning behind anonymous `FIELD
  A–F` removed the context that makes the composition a vehicle wrap rather than
  abstract art; drawing that context into the pixels is the opposite error.

  The output defect is any vehicle depiction or opening rendered into the
  printable rectangles instead of artwork painted through at full opacity.
  The sheet must read as **ONE cohesive flat production master**, not six
  designs sharing a canvas and not a flattened vehicle illustration.

  **The rule this violated: RULE 0.1 — a design below baseline means the port or
  the inputs are incomplete, it NEVER means A.C.E. needs new creative
  direction.** Rewriting the creative framing to fix a pixel defect is exactly
  the move that rule forbids.
- **`runtime/atlas-master-qc.cjs`** measures `flatBlackRatio` (near-black blob
  *interiors*, not edges) against `nonBlackFraction` — the SHARE of the zone that
  is artwork. A cutout is a minority of flat black inside a zone that is mostly
  artwork; a black wrap is mostly black. Measured on fixtures: punched
  wheels/glass = 22% flat black with 77% artwork (fails), black wrap = 90% flat
  black with 10% artwork (passes).

  **Do not use the mean brightness of the non-black pixels as the
  discriminator.** That was the first attempt and it convicts black wraps: a
  mostly-black design still has vivid accents, so the mean over its non-black
  pixels reads high. Locked by `tests/atlas-master-qc.test.mjs`, which fixtures
  all three cases.

  **Do not use the raw flat-black aggregate as the discriminator either.** That
  was the second attempt, and the first REAL master through the gate
  (2026-08-24) proved it convicts artwork: driver read 7.3% flat black across
  **3,761 components** — anti-aliased lettering interiors and shadow detail,
  average component 0.002% of the zone. A die-cut wheel is ONE shape. The
  synthetic fixtures were clean flat colours and could never produce that
  texture. The aggregate now counts only components ≥0.25% of the zone
  (`concentratedFlatBlackRatio`); a punched opening is orders of magnitude
  above that floor, so every hole fixture still convicts. Ink scattered as
  specks is design; ink concentrated in shapes is a hole.

  The `2026-08-31` production master exposed a separate deterministic class:
  **cross-surface structural template leakage**. A repeated signature of
  mirrored flank gutters beside full-axis guide lines plus matching outlined
  bands on multiple centre surfaces is a blocking structural failure. The
  signature is deliberately narrow: a legitimate white-base livery does not
  fail merely for containing white artwork. This gate does not use semantic AI
  and does not repaint opaque white anatomy with the dark cut-out fill.

**Do not relax deterministic structural thresholds to get a run through.** A
master that fails required container coverage, opacity, canonical artifact,
hash, dimensions or lineage is invalid. Semantic/visual review is advisory and
may not refuse or delay Call 1. Production defaults to one creative image call;
an explicit operator authoring attempt may use the existing bounded retry
contract, but a browser/network retry may never mint a second master.

### A CUT-OUT IS A PRINT DEFECT, NOT A BROKEN DESIGN (Trish 2026-08-24)

**A cut-out must never destroy the design or its seven proofs.** The 3D proof
masks the master to the real painted body — the proof prompt says so in as many
words — so a hole where the wheel arch sits lands in the region the mask
discards anyway. The proof is unaffected *by construction*. Live proof: the
Flamingo Pools seven-view set (`DID-5B2EB96C`, prompt version `…20260822.v2`,
`masterQcPassed = null`) came out of a completely ungated cut-out master and
every one of its proofs is correct. **The hole only becomes real at the panel
cut**, where it prints as a hole in the vinyl.

Killing the whole request at authoring therefore had the blast radius exactly
backwards: it destroyed a good design, its DesignID and all seven proofs to
prevent a defect that only exists in the extracted panels. So the two failure
classes are now separated, and `deterministicMasterChecks` returns them apart:

| class | examples | consequence |
|---|---|---|
| **blocking** — structurally invalid authority | blank/missing zone, broken container coverage, invalid canonical bytes/hash/lineage | fatal; downstream production has no valid source |
| **cut-out** — a defect in the *panel* | wheel arch, glass, bed opening punched out | design and proofs survive, affected surfaces flagged |

Semantic review may report coherence, brief-fidelity or lettering concerns, but
it is advisory. It cannot block publication of a deterministically valid Call-1
authority. `masterCutoutSurfaces` / `masterCutoutFindings` remain durable
forensic evidence for PanelPro human review.

**Those surfaces' panels must not print until a human has seen them on a
template.** That is what `await_panelpro_preflight_qc` is for. `masterQcPassed`
stays `true` because the *design* passed; the cut-out is panel-scoped and
carried separately. Locked by `tests/atlas-master-qc.test.mjs`.

### DO NOT RE-ROLL FOR A CUT-OUT. FILL IT. (Trish 2026-08-24)

**A cut-out is never worth another authoring pass.** Re-rolling costs ~60s and
buys nothing: the proofs mask that region away, so the design is already
correct, and the panel is repaired deterministically. Spending three passes
hoping Gemini draws it solid put two minutes on the critical path *before the
customer saw a single image*. Call 1 now breaks on a cut-out's first
appearance. Re-rolls remain only for a broken **design**, where another throw is
genuinely the only remedy.

**BOTH halves use the filled duplicate — the proofs too. (Corrected 2026-08-26.)**
`runtime/atlas-cutout-fill.cjs` closes each convicted hole by repeatedly
averaging its boundary pixels from the artwork they already touch, growing the
surrounding design inward from every side. Deterministic, ~100ms, no AI, **no
second producer of design**.

This section used to read *"the proofs use the authored master; the panels use a
filled duplicate"*, justified by "the two differ only inside the holes, which is
precisely the region the 3D proof masks away." **Production canary
`6667efac-6d62-4e8f-bf3c-39aa805ed352` (2026-08-26) disproved that with a
measurement.** Driver and passenger each came back with **26.7% of the zone
punched out across four components** — a vehicle silhouette, not a wheel arch.
The proof QC is handed that exact surface crop as "the sole artwork authority",
and refused every view conditioned on it, verbatim:

> "The candidate proof shows a Ford F250 Crew Cab truck, but the authority image
> shows a cargo van."  — `side`, and the same finding on `passenger-side` and
> `close-up`

Three of seven proofs survived, and they were the three whose surfaces had the
smallest cut-outs or none. Meanwhile the repaired duplicate — a solid rectangle
of continuous livery — sat unused by the proof half.

So `projectionDerivative` and `buildViewAuthorities` now take
`surfaceSourceBytes`, the same bytes `cutCallOnePanels` takes. **On a clean
master nothing changes at all**: the fill returns the same buffer, so the
projection and all six surface crops are byte-identical to before. This is also
what RULE 0.21 already states — *"those SAME surface regions condition the
matching 3D proof views"*.

### ⚠️ SUPERSEDED — THE ACCEPTED MASTER *IS* THE REPAIRED SHEET (Trish 2026-08-31)

**Owner, reading the code after the post-repair re-validation landed:** *"even
after successfully repairing and re-validating the sheet, the progressive/
canonical A.T.L.A.S. object still points to the ORIGINAL pre-repair masterBytes
and masterHash … A.T.L.A.S. shown to humans = bad original, Panels/proof
authority = repaired derivative. That is not one canonical authority."*

That is the contradiction PanelPro printed on its face — *"repaired sheet ·
Master QC passed"* over a sheet visibly full of holes — and it is why the owner
saw a corrupt A.T.L.A.S. while the panels were cut from something else.

**So the two-master model below is retired.** After structural re-validation
passes, the repaired bytes BECOME the accepted canonical master:

```text
acceptedMasterBytes = cutoutFill.changed ? surfaceSourceBytes : masterBytes
acceptedMasterHash  = cutoutFill.changed ? panelSourceHash    : masterHash
```

and the published root, the six panels' `sourceMasterHash`, the persisted bytes,
the revision row, the proof authority and both UIs all cite that one hash.

**Why this does not reintroduce the defect the old rule guarded against.** The
old warning was real: publishing the repaired hash as the panel lineage made a
correct pair report *"the proof and the panel came from different masters"* —
true while TWO masters exist and the panels cite the one that is not canonical.
Promoting the repaired sheet to canonical DISSOLVES that split rather than
moving it: afterwards there is exactly one accepted master.

The pre-repair sheet is kept as `preRepairMasterHash` — **provenance only**. It
may never again be called the canonical master, the accepted master, or the
thing "Master QC passed" refers to.

On a clean master this is identity: `fillMasterCutouts` returns the same buffer,
`changed` is false, both bindings fall through to the original bytes and hash,
the storage path is the one already derived, and the re-validation is skipped —
no extra transform, no extra hash, byte-identical output. Locked by
`tests/atlas-accepted-master-is-the-repaired-one.test.mjs`, which convicts a
pre-repair canonical root, a pre-repair panel lineage, and promotion before
validation.

**Also blocking now: a zone whose artwork never reaches its own border.**
`edgeOpaqueRatio` was the full-bleed test and it measures ALPHA — and black is
opaque, so a vehicle silhouette on a black surround scored 1.00000 and was
accepted. `edgeHoleRatio` measures the same border ring with the same `holeAt`
predicate the cut-out detector and the fill share; a majority-artwork zone whose
border is >35% hole is a BLOCKING structural failure, not a repairable cut-out.
The threshold is this file's own v4 measurement (good masters: border median
135–177; the failing run: 63–83% of each border dark). The bright-majority guard
keeps a legitimate black wrap legal, with its own fixture.

#### HISTORICAL — the two-master model, superseded above

**`sourceMasterHash` is LINEAGE, not provenance.** A panel publishes the
CANONICAL master hash, because that is the identity PanelPro pairs it with its
proof by; the repaired sheet it was actually cut from is recorded separately as
`surfaceSourceHash` (and on the revision as `panelSourceHash`). Publishing the
repaired hash as the lineage made a correct pair report *"the proof and the panel
came from different masters"*. Locked by
`tests/atlas-repaired-sheet-conditions-proofs.test.mjs`.

- The master is **never mutated** — same rule as the Call 11 de-logo set:
  duplicate, modify the duplicate, preserve the original byte for byte. It stays
  the persisted lineage identity (`canonicalMasterHash`, the revision's
  `master_content_hash`, every UI binding); the repaired duplicate is what both
  the panels and the proofs are derived from.
- The fill reads its mask from `atlas-master-qc.cjs`'s **own exported
  thresholds** (`CUTOUT_ALPHA_MAX`, `FLAT_BLACK_CHANNEL_MAX`,
  `MIN_CUTOUT_COMPONENT_RATIO`). Two definitions of "hole" would let the fill
  miss a shape the gate convicted, or erase artwork it never objected to.
- Master and duplicate differ **only inside the holes**, and both halves of the
  fan-out read the duplicate, so proof and panel agree everywhere either asserts
  anything. `panelSourceHash` records what the panels were cut from and the
  proofs were conditioned on; it equals `canonicalMasterHash` on a clean master.
  It is **not stored as bytes** — `fillMasterCutouts` is deterministic, so a
  resumed revision rebuilds it and `flat_atlas_surface_source_mismatch` refuses
  a rebuild that no longer reproduces the recorded hash.
- **Mirroring is not used.** It is well defined across a straight outer edge,
  which is why the 5″ bleed uses it, and undefined across an interior hole.

It does not invent: a large hole closes as a soft continuation of its own
border, not as new design. `masterCutoutSurfaces` still records that the sheet
arrived holed, and PanelPro's human QC still sees those sides flagged. Locked by
`tests/atlas-cutout-fill.test.mjs`.

## 📸 RULE 0.29 — THE 3D PROOF STACK IS THE REAL RESTYLEPRO STACK, PINNED (Trish 2026-08-27)

For every extracted A.T.L.A.S. panel, the proof producer is the REAL RestylePro
photographer stage — not a new generic renderer. Sources, at
`restylepro-os@113d137dbe8813ca3bf70c8d7265ad081ebd4524`:

| role | file | pinned sha256 (16) |
|---|---|---|
| 3D proof producer | `supabase/functions/persona-photographer-render/index.ts` | `7aefea1f1b8ca899` |
| prompt builder | `supabase/functions/_shared/persona-photographer-prompt.ts` | `11cb76524211e42a` |
| camera, framing, frame-fill | `supabase/functions/_shared/view-angles-os.ts` | `8890be50c124a2c5` |
| studio **and lighting** | `supabase/functions/_shared/studio-os.ts` | `7b02814bb1e9e867` |

All four are byte-identical to the pin, asserted by
`tests/proof-stack-pinned-sources.test.mjs`.

- **`view-angles-os` owns camera angle, framing and frame-fill.**
- **`studio-os` owns the studio environment AND the lighting** — the LED strips,
  daylight balance, reflections, wall/floor treatment, and the requirement that
  the studio stay identical between views. **Do not invent studio or lighting
  prompts in the server runtime.** The runtime consumes `STUDIO_ENVIRONMENT`; it
  never restates it.
- **HERO IS REMOVED (owner, 2026-08-27).** `view-angles-os` had drifted from the
  pin by one added `hero-3d` shot; it is restored to the pinned bytes and the
  plan is the canonical seven views. The runtime keeps its legacy `hero-3d` →
  `hero3d` READ mapping so historical generations stay viewable (owner
  protection #1) — that is a read path, not a plan entry, and it is not a licence
  to render one.

**Adapt, do not restore blindly.** The pinned photographer describes a
historical six-shot sequence and an old `heroRenderUrl` continuity dependency.
Keep its photographer/studio/view-angle logic; replace the artwork authority
with the matching extracted A.T.L.A.S. panel for the requested `shotKey`, and
drop the hero-first dependency. Per surface:

`driver panel → shotKey driver` · `passenger panel → passenger-side` ·
`hood panel → hood` · `front panel → front` · `rear panel → rear` ·
`roof panel → roof` · `close-up → the correct selected surface/detail authority`

**The canonical Call-1 panel is ARTWORK authority. The photographer/view/studio stack
is PRESENTATION authority only.** Every output must persist `generationId`,
`atlasRevisionId`, `sourceMasterHash`, `surfaceKey`, the source panel artifact
id + hash, and `shotKey`, so both UIs can prove a proof came from its matching
panel.

### ✅ IT IS NOW WIRED THAT WAY — THE DEPLOYED PHOTOGRAPHER RENDERS EVERY PROOF (Trish 2026-08-28)

Owner, verbatim: **"DO NOT CREATE ANOTHER 3D EDGE FUNCTION. Use
`supabase/functions/persona-photographer-render/index.ts` with
`persona-photographer-prompt.ts`, `view-angles-os.ts`, `studio-os.ts`. For
ATLAS, replace the historical `heroRenderUrl` artwork reference with the
matching persisted `sourcePanelUrl`/`sourcePanelHash`. Passenger must receive
its Passenger panel. Driver must receive Driver. Hood receives Hood, etc. Do
not skip the panel input for Passenger. Do not use Driver as artwork continuity
authority. ATLAS panel = artwork authority. Photographer + angles + studio +
lighting = presentation authority only."**

Until this date the pin above was a REFERENCE the runtime imitated: the proofs
were produced by `createAtlasDesignPanelProvider`, which built its own
`buildAtlasProjectionPrompt` and called Gemini through the key pool. It reached
the same studio and the same angles by importing the same kernels, so no single
line of it was wrong — but a second implementation of a proven stage drifts, and
the A/B against the pin showed exactly that: a Driver continuity photograph the
proven stack never sent, a 3.5K prompt against the photographer's 1.4K, its own
retry ladder, its own aspect ratio, and a nine-contract acceptance judge with no
counterpart in the pin at all. Live cost on request `f3eb40c1`: every one of the
eight refusals was a JUDGE VERDICT on a rendered image, not a renderer error.

**The producer is now the deployed function, in `mode: "atlas-proof"`:**

| authority | owner | changed? |
|---|---|---|
| words | `persona-photographer-prompt.ts` → `buildPhotographerPrompt` | no |
| camera, framing | `view-angles-os.ts` → `CAMERA_ANGLES[shotKey]` | no |
| studio, lighting | `studio-os.ts` | no |
| model + fallback | `model-config.ts` | no |
| **artwork** | **the surface's persisted canonical Call-1 panel (later Call-9-promoted without byte change)** | **yes — this is the one** |

`persona-photographer-prompt.ts`, `studio-os.ts` and `view-angles-os.ts` stay
byte-pinned. `persona-photographer-render/index.ts` is now ADAPTED, per this
rule's own "adapt, do not restore blindly", and
`tests/proof-stack-pinned-sources.test.mjs` asserts the adaptation touched the
artwork input and nothing else.

**Four behaviours that must never come back:**

1. **`skipHeroShots = ['passenger-side', 'close-up']`.** The hero path dropped
   the reference image for those two shots because a DRIVER-SIDE hero biased
   the camera. That reasoning dies with the swap: the passenger panel is not a
   driver photograph, it is the passenger side's own artwork, and dropping it
   leaves the model to invent that flank. Every shot gets its own panel.
2. **A text-only retry.** The hero path re-sent `[{ text: prompt }]` on attempts
   2+. Under a hero that lost a hint; here it loses the ARTWORK and the proof
   becomes a different wrap. The panel rides every attempt.
3. **The Driver continuity reference.** Added 2026-08-26, ruled out by name
   here. Cross-view identity rests on the shared master, hash-bound per
   surface — a stronger guarantee than injecting one render into the others.
4. **A public URL for the panel.** `wrap-files` is private; a public URL 400s.
   The panel travels as a STORAGE PATH plus sha256, and the function verifies
   the bytes are the artifact the caller named (`atlas_proof_panel_hash_mismatch`),
   as does the caller on the returned proof.

The roof is included even though `PHOTOGRAPHER_SHOT_SEQUENCE` is the historical
SIX-shot magazine sequence: `CAMERA_ANGLES` carries all seven, so `atlas-proof`
resolves against `ATLAS_SHOT_SURFACES` instead. That changes which pinned angle
may be requested, never the angle text. A shot handed the wrong surface's panel
is refused (`atlas_proof_surface_mismatch`), never rendered.

## 📐 RULE 0.28 — ONE NAMED VEHICLE A.T.L.A.S. ON GENIE CONTAINERS, FILLED EDGE TO EDGE, WITH NO BODY LINES (Trish 2026-08-27; corrected 2026-08-31)

Owner, verbatim: **"ATLAS FLATTENED TOPO VIEW CONTAINER MUST HAVE LABELED
CONTAINERS AND GENIE DIMS WITH 5\" BLEED — ATLAS FILLS FLATTENED TOP DESIGN
WITHOUT BODYLINES FILLED TO RECTANGLE CONTAINER EDGES."**

1. **Sizes come from the GENIE Panelizer catalog**, `vehicle_dimensions` (1781
   measured rows, migrated 2026-08-27). `resolveFlatAtlasPreviewDimensions`
   reads it FIRST. The class-constant estimator
   (`provisionalDimensionsFromCandidate`) is only what happens when the catalog
   has never seen the vehicle. Measured cost of not doing this: GENIE has the
   F-250 Super Duty Crew Cab side at **251×60**; the estimator produced
   **153×56** — ninety-eight inches short, on every container.
2. **One geometry, two consumers.** The durable installer guide carries the
   named surfaces, GENIE dimensions and 5″ bleed for humans and forensic
   checks. The image model receives the same six-region geometry as a clean,
   unlabeled mask plus a server-authored text mapping for Passenger, Driver,
   Rear, Roof, Hood and Front. It does not receive anonymous `FIELD A–F`
   aliases, pixel dimensions or installer annotations.
3. **Filled edge to edge.** Artwork runs off all four sides of its rectangle.
   No blank margin, white gap, letterboxing, rounded corner, frame or border.
4. **NO BODY LINES.** No door seams, panel gaps, rocker or hood contours, wheel
   arches, windows, glass, lights, handles, bumpers or vehicle silhouette. The
   artwork paints straight THROUGH every place one would sit.

### ⚠️ THIS NARROWS RULE 0.15, BY THE OWNER'S OWN DECISION — DO NOT "RESTORE" IT

RULE 0.15 says an A.T.L.A.S. master legitimately carries the vehicle's panel
geometry (door seams, rocker and hood contours) and warns loudly about a session
removing that to chase a pixel defect. **That warning still stands for a
session. It does not bind the owner, and she has now decided the opposite on
this one point (2026-08-27), looking at the live output.** Holes were already
forbidden; seams, contours and arches are forbidden now too, because a line
drawn on the master prints as a line on the wrap.

Everything else in RULE 0.15 is unchanged: a panel is still one solid rectangle,
still opaque corner to corner, and a zone that returns a picture of a vehicle is
still a failed master.

5. **Unwrapped regions never become holes in Call-1 artwork.** Owner: *"masked
   truck bed must not have any wrap design."* A pickup's bed floor and inner
   walls carry no installed vinyl, but Call 1 still fills every source rectangle
   completely. That exclusion belongs to downstream vehicle application/proof
   mapping. Do not claim a dedicated deterministic bed contour mask exists
   unless its durable contract and artifact are identified.
6. **Every 3D proof is built from that side's canonical Call-1 panel, and nothing
   waits.** Owner: *"ALL 3d from extracted panels — no waiting. Individual
   panels fed to 3d sides and duplicated, put in RevisionStudioIQ alongside 3d
   proofs and in PanelPro with all upscaled assets."* `panel(surface) → 3D
   proof(surface)` the moment that panel is cut. `buildViewAuthorities` /
   `viewAuthorityFor` must hash-bind to the persisted Call-1 panel rather than
   to a fresh crop of the master — same strictness, pointed at the artifact the
   customer actually buys. Each panel is then duplicated and published without
   waiting for the set: RevisionStudioIQ beside that side's proof, PanelPro with
   the upscaled assets.

### THE SHELL IS THE OWNER'S TOPO SHEET (Trish 2026-08-27)

**CURRENT CONTRACT — 2026-08-31.** The master uses one fixed 4096×4096
six-region canvas. That square storage canvas is not an aspect-ratio quality
fix. `CENTER_ORDER` is `rear → roof → hood → front`. The model-facing guide is
an unlabeled, unstroked deterministic mask so labels and dimensions cannot be
copied into artwork. Canonical YMM, body class and the named Driver, Passenger,
Rear, Roof, Hood and Front mapping travel in the Call-1 text/data contract. The
separate human installer map may show labels, IDs and dimensions. Do not restore
anonymous `FIELD A–F`, model-facing technical furniture, or a vehicle silhouette.

#### HISTORICAL SHELL DESCRIPTION — SUPERSEDED; DO NOT IMPLEMENT

Historical spec: **"A.T.L.A.S. FLATTENED – TOPO TOP VIEW · SINGLE SOURCE MASTER · SIX
DETERMINISTIC PANELS · 1:1 TOPOLOGY"**. The shell renders exactly that:

- **Centre column reads ROOF → HOOD → FRONT → REAR from the top.** `CENTER_ORDER`
  IS the layout; the panels follow `manifest.zones`. It was rear/roof/hood/front,
  a physical front-to-back unroll — correct as geometry, not what the sheet draws.
- **Two rectangles per container.** Outer = the container (structural). Inner
  **dashed blue** = the printable area, the exact panel crop, drawn at `zone.trim`
  — the box `trimRectangle()` has always computed inside the 5″ bleed.
  `cutCallOnePanels` still crops the full container; the dash is what the model
  fills corner to corner and runs past.
- **Every container captioned** with its name, `Surface ID: XX`, `W: n px`,
  `H: n px`, upright, level with the container.
- **Faint top-view vehicle silhouette + grid** under everything, so the sheet
  reads as topography rather than three columns of boxes.
- **Header band + footer** (`ATLAS MASTER SHELL · 4096 x 4096 px · TOPOLOGY VIEW ·
  NOT PRINTABLE`), both in the canvas margin.

**Why the captions are beside the containers and not on them.** The sheet draws
them inside a generous structural border. Real GENIE geometry has no such border:
5″ of bleed on a 251″ flank is ~70px on the 4096 canvas, so four stacked lines
render at 10px — a smudge, not a label. The room that exists is the gutter, which
carries the same four lines upright at ~28px.

**⚠️ THE GUARD NOW PROTECTS `zone.trim`, NOT THE WHOLE CONTAINER. DO NOT WIDEN IT.**
`renderAtlasAuthoringGuide` used to throw on any `<text>` at all. That was a proxy
for the 2026-08-25 `artifactFreeContract` deaths, and the proxy was wider than the
defect: what came back painted was a surface name centred **ON** the area the model
was told to fill. The paint area is the dashed trim box. Every `<text>` must
declare an x/y anchor (`flat_atlas_authoring_guide_text_unlocatable` otherwise) and
every anchor must lie outside every `zone.trim`
(`flat_atlas_authoring_guide_contains_text`). A caption is also physically unable
to reach a customer: the master is masked to the zone rectangles and each panel is
finished to trim.

Historical contract `atlas-artboard-designiq.20260827.v5`, folded into the Call-1 `promptHash`
so masters authored against the old shell are not reused. `PROMPT_VERSION` stays
`designpro-flat-first-atlas-20260827.v10-edge` — **no migration cutover.**

### SUPERSEDED — the gutter-caption form (2026-08-27, earlier the same day)

Owner, looking at the live master: **"You almost had it just fix so it's a true
topography flattened view labeled containers"**, against a spec sheet reading
*A.T.L.A.S. FLATTENED – TOPO TOP VIEW · SINGLE SOURCE MASTER · SIX
DETERMINISTIC PANELS · 1:1 TOPOLOGY* with every container carrying its Surface
ID and its W/H in pixels.

**The topology was already right.** `buildAtlasManifest` has always produced
passenger flank as a tall left column, a centre column running vehicle-rear to
vehicle-front, driver flank as a tall right column. What the ARTBOARD lacked
was identity: the copy handed to the authoring model carried geometry and
nothing else, so six unnamed grey rectangles had to be mapped onto six names
carried separately as prose.

So both guides now caption every container — `DS · DRIVER`, its pixel size, its
GENIE inches + 5″ bleed — plus the topo title band, and the Call-1 panel list
carries the same Surface ID and placement (`DS — DRIVER SIDE — tall column down
the RIGHT edge — 251" x 60"`) so the list and the sheet name the same rectangle.

**⚠️ THIS NARROWS THE "NO TEXT AT ALL" GUARD, DELIBERATELY. DO NOT WIDEN IT BACK.**
`renderAtlasAuthoringGuide` used to throw on ANY `<text>`. That was a proxy for
the 2026-08-25 `artifactFreeContract` disaster, and the proxy was wider than
the defect: what came back painted was a surface name centred **ON** the
rectangle the model was told to paint. A caption in the empty gutter is a
different object, and it is safe twice over — no glyph is inside a paintable
rectangle, and `normalizeAtlasMaster` masks the delivered sheet to the zone
rectangles (`activeZoneMaskSvg`), so anything painted in a gutter is discarded
before a master exists. The margin is structurally unprintable.

The guard is therefore **positional**, and still fail-closed: every `<text>`
must declare an x/y anchor (`flat_atlas_authoring_guide_text_unlocatable`
otherwise) and every anchor must lie outside all six zones
(`flat_atlas_authoring_guide_contains_text`). The prose telling the model what
NOT to paint still never reaches it — that footer stays on the human map only.
Locked by `tests/atlas-authoring-guide.test.mjs`, whose fixture is now built by
the real `buildAtlasManifest` rather than hand-placed rectangles.

Enforced by `tests/atlas-artboard-edge-call1.test.mjs` and
`tests/genie-catalog-sizes.test.mjs`. Contract version
`atlas-artboard-designiq.20260827.v4` — it is folded into the Call-1
`promptHash`, so masters authored against the unlabeled artboard are not
reused. The DB-pinned `PROMPT_VERSION` is unchanged at
`designpro-flat-first-atlas-20260827.v10-edge`, so this needs no migration
cutover. This paragraph is historical; the current v15/v14 contracts and
2026-08-31 correction at the top of this file are authoritative.

## 🧬 RULE 0.27 — ONE ARTIFACT GRAPH. CODE OWNS THE ARTBOARD; A.I. OWNS THE DESIGN. (Trish 2026-08-27)

**Full directive: `docs/ATLAS_ONE_ARTIFACT_GRAPH.md`. Read it before touching
RevisionStudioIQ, PanelPro Studio, Call-1 panel separation/publication or the proof fan-out.**

The owner proved the pipeline is still split, from the product's own screens:
PanelPro reported **Print panels 0/6** while RevisionStudioIQ showed images in
its Production Pack column; PanelPro reported **3D proofs 8/7**; a roof proof
existed in one surface and was reported missing by another. Three numbers about
one design that cannot all be true.

> "Your intended architecture was one source → duplicate publication, whereas
> the current implementation has become one source → several independently
> reconstructed representations."

Three rules follow, and they are architectural, not cosmetic:

1. **HARDWIRE THE ARTBOARD SHELL.** Gemini must not be responsible for drawing
   the A.T.L.A.S. containers. Code/GENIE deterministically builds the six
   rectangular surface containers, their real GENIE proportions, positions,
   surface IDs and the master canvas. The model-facing mask stays free of
   printable labels; the Call-1 data/text maps every region to its named
   vehicle surface. DesignPanelAI then authors ONE cohesive wrap INSIDE those defined
   interiors in ONE Call 1. **The A.I. owns the design; the code owns the
   geometry.** Still one source design, still one authoring call.
2. **THE MASTER FANS OUT IN PARALLEL, IMMEDIATELY.** Canonical Call-1 panels
   (+5" bleed), logo/asset analysis, and the Driver proof all start on master acceptance. The
   user-facing critical path is ONLY `Call 1 → Driver proof`; on "See All
   Sides" the remaining six render concurrently. Panels and logos are never
   behind the proof set.
3. **ONE LINEAGE, PUBLISHED TWICE — NEVER RECONSTRUCTED TWICE.** The SAME
   persisted artifacts go to RevisionStudioIQ and PanelPro Studio. No separate
   RevisionStudio panel producer, no client-side crop, no preview standing in
   for a production panel. **Neither UI may synthesize its own representation of
   a missing canonical artifact** — a missing panel is reported missing.

Acceptance: one fresh generation showing 1 master at 4096×4096, 6/6 persisted
panels with 5" bleed, extracted assets, Driver first, 7 canonical proof slots,
both UIs populated FROM THE SAME ARTIFACT IDS, all bound to one `generationId`
/ `DesignID` / `atlasRevisionId` / `masterContentHash`. **Do not report READY
while either UI is synthesizing a missing artifact.**

Status 2026-08-31: server fan-out and Call-1 panel persistence exist. The
observed regressions are specific: Call 1 was conditioned as anonymous fields;
PanelPro treated a thin index record as a hydrated job and hid Call-1 panels;
the Hood proof staging allowlist rejected `hood_detail`. Repair those proven
defects without adding a producer or changing graph authority.

## 🎯 RULE 0.26 — ONE CANONICAL CALL 1: THE REAL EDGE FUNCTION EXECUTES THE PERSONA BRAIN (Trish 2026-08-27, supersedes the 08-26 vendored-bridge form)

**Owner directive (PASTE_TO_CLAUDE.md, 2026-08-27): "Call 1 must execute through
the actual deployed `supabase/functions/design-panel-ai-generate/index.ts` …
For its ATLAS/artboard mode, import and execute the real `buildDesignerPrompt`
from `../_shared/persona-designer-prompt.ts`. Do not reproduce its words in
another runtime file." Behavioral authority = the pinned edge functions from
`Tdill1980/restylepro-os` @ `113d137…` (persona-csr-enrich,
persona-designer-generate + persona-designer-prompt.ts,
persona-photographer-render, logopro-*, studio-os, view-angles-os,
artboard-template-os) — the working creative stack the source audit
(`SOURCE_AUDIT/WORKING_DESIGN_PIPELINE_EDGE_FUNCTIONS.md`) identifies.**

How it is implemented — DO NOT re-split it:

- `design-panel-ai-generate` (deployed on this project) is the SOLE Call-1
  network endpoint: `mode: "atlas-artboard"` dispatches to
  `handleAtlasArtboard`, which makes exactly ONE Gemini image request and
  returns the flattened master + full provenance (requestId, functionName,
  sourceCommit, promptVersion `atlas-artboard-persona.20260827.v1`, model,
  imageRequestCount, masterSha256).
- The prompt assembly is ONE canonical module,
  `supabase/functions/_shared/atlas-artboard-prompt.ts`: it EXECUTES the real
  `buildDesignerPrompt` (never re-types it), swaps ONLY the presentation tail
  (studio scene, side camera, on-vehicle photo lines) for the flat-master
  output contract via exact-match throw-on-drift replacements, and appends the
  owner logo contract (LOGO_REQUIREMENT + typeface-is-not-a-logo) and contact
  lock (no invented phone/website) — byte-locked against
  `runtime/designiq-prompt.cjs` so the two homes cannot drift.
- `runtime/flat-first-atlas.cjs` assembles NO creative text and makes NO
  direct Gemini request for Call 1: `atlasEdgeRequestBody` maps the verified
  input + GENIE manifest onto the request, `callAtlasArtboardEdge` POSTs it,
  verifies the returned master sha256, enforces `imageRequestCount === 1`, and
  records the provenance chain (`metadata.atlasEdgeProvenance`). QC gate,
  cut-out fill, deterministic panel cut and lineage hashes are unchanged.
  `PROMPT_VERSION` = `designpro-flat-first-atlas-20260831.v16-flat-example-only`.
- DELETED from the product path (do not restore): the transpiled vendor bridge
  `runtime/vendor/designpanel-authoring.cjs` + its build script, the
  reconstructed `buildAtlasArtboardDesignIQDirection`, the SIDE-TWIN
  photographic-scene framing, and any direct Call-1 Gemini invocation outside
  the edge function.
- Locked by `tests/atlas-artboard-edge-call1.test.mjs` (both halves of the
  contract, plus the persona-drift alarm), and the assembly module is
  transpiled and EXECUTED by `tests/designpro-persona-contract.test.mjs` /
  `tests/designpro-reference-authority.test.mjs`.
- The v9 DB pin (20260826090000) was applied to production and REVERTED live
  the same night (the deployed runtime still emits v8);
  `20260827010000_designpro_atlas_revert_v9_pin.sql` captures that revert
  idempotently. SHIP ORDER for v10: the DB gate must learn v10-edge in the
  same cutover as the runtime that emits it — runner and gate may not diverge
  across a customer-visible window again.
- Acceptance (owner correction 2026-08-31): do not run speculative canaries and
  do not substitute a canary for the real deployed customer-style DCA. After
  the earlier no-canary instruction, the owner explicitly authorized a fresh
  production canary while away so the observed source and Call-8 defects can be
  verified on the deployed path. That authorization is specific; acceptance is
  still pending until the corrective release is deployed and the new run
  produces inspectable evidence.
  Publish the accepted master and six Call-1 panels immediately; continue the
  same lineage through the required views, Call 8 and Call-9 promotion; then
  stop the real DCA in PanelProStudio for owner confirmation before Full QC.

## 🖥️ RULE 0.16 — CALLS 1–7 EXECUTE ON THIS SERVER (2026-08-23)

`design-panel-ai-generate` and `generate-color-render` run **in this runtime**,
against the server key pool, behind the worker secret. The persona stack is
ported by name:

| File | What it is |
|---|---|
| `runtime/designiq-prompt.cjs` | A.C.E., ported verbatim from `supabase/functions/design-panel-ai-generate/index.ts` |
| `runtime/view-angles.cjs` | the locked seven camera angles |
| `runtime/studio-os.cjs` | studio lighting |
| `runtime/photorealism-prompt.cjs` | the photorealism lock |

`standardProviderFactoryFor()` in `runtime/generation-worker.cjs` defaults to
`createDesignPanelServerProvider`. **The Supabase Edge transport is an explicit
rollback only** — `DESIGNPRO_STANDARD_TRANSPORT=edge`. Unset, or misspelled,
resolves to the server, so Edge can never become the default again by omission.
It was the default on 2026-08-23 and cost six of seven views to
`provider_attempts_exhausted`.

**Both pipelines produce 3D proofs through that same stack.** A.T.L.A.S. makes
exactly **one** fast flattened AI call for the canonical top-view master; every
camera after it is a projection, and the panel cut is pure geometry.

### 🎛️ THE AUTHORING MODEL IS PINNED BY NAME — AND THE NAME IS THE **GA** ID (2026-08-26, corrected same day)

**Pinning by name stays. The value was wrong, and it was wrong on my own
evidence.** The droplet writes `GOOGLE_IMAGE_MODEL=gemini-3-pro-image`
(`ops/configure-env.sh`), and `lockModel` alone pins **the first of whatever is
configured** — config drift, not a pin. That half of the rule is unchanged:
`DESIGNPANEL_AUTHORING_MODEL` names it, Call 1 passes it as `model:` alongside
`lockModel: true`, and **it must not become an env lookup** — the projections may
follow `GOOGLE_IMAGE_MODEL`, the design authority may not.

It was briefly set to `gemini-3-pro-image-preview`, because the reference builds
that id into its endpoint (`index.ts:1320`) and because **one** A/B pair on the
Precision Climate Solutions payload preferred it. **Eleven real production runs
say the opposite**, measured as border-vs-interior luminance on the actual
masters pulled from storage:

| generation | date | prompt | model | flanks | centre four |
|---|---|---|---|---|---|
| `5b2eb96c` | 22 Aug | v2 | GA | **full bleed** (border 147) | **full bleed** (141–167) |
| `87c481ca` | 23 Aug | v4 | GA | picture of a vehicle (0) | full bleed (135–177) |
| `9dd6d43c` | 26 Aug | v8 | GA | picture of a vehicle (0) | full bleed (137–175) |
| `04cc0b29` | 26 Aug | v8 | **preview** | picture of a vehicle (18) | **picture of a vehicle (20–23)** |

Every GA run holds a border median of 135–177 across the centre four on every
prompt version from v2 to v8. The first `-preview` run drops it to 18–23 with
63–83% of each border dark. **The Flamingo master this product is judged against
(`5b2eb96c`) was authored on the GA id**, and so were its seven good proofs.

**One A/B pair is not eleven production runs.** A single sample on one payload is
exactly the measurement that should lose to the fleet, and this one did.

### ✅ THE v4 FLANK REGRESSION IS NOW LOCATED AND REPAIRED

Same table, different column. `driver` and `passenger` come back as a vehicle
silhouette on a dark surround from **v4 onward, on every model**, while the
centre four stayed clean. v4 (`5b8f75d`) is the commit that created
`runtime/flat-first-atlas.cjs`, and it added the **only flank-specific sentence
in the whole prompt** — the SIDE-TWIN CONTRACT, which tells the model those two
zones share a *"scene"*, *"landmarks"* and a viewpoint *"reversed for the
opposite flank"*. That describes a photographed vehicle side. The centre four are
never mentioned by it and never broke.

The same commit added the negative block — *"Do not draw or punch out vehicle
windows/glass, wheel arches… Do not draw a vehicle, camera scene, shadows"* —
which is the prompt shape this file already warns Gemini over-indexes on.

The current repair is evidence-based: the Call-1 contract restores canonical
year/make/model, GENIE body class, the six named physical surfaces and the
proven vehicle-wrap designer persona. It removes anonymous `FIELD A–F`
conditioning and the active Driver-to-Passenger rewrite. Passenger remains its
own authored Call-1 region; continuity is required at the design-system level,
not by forcing pixel mirroring. A production canary may diagnose the live graph
when the owner explicitly requests it; the real owner-visible production DCA
remains the final customer-path acceptance test.

**v2's prompt text is not in this repository.** `flat-first-atlas.cjs` was created
at v4, so the Aug-22 code was never committed here — the v2 evidence is
behavioural, measured on the stored artifact, not a text diff. Do not go looking
for a v2 source file; there isn't one.

### 🖼️ A PROMPT MAY NOT CITE ATTACHMENTS THE REQUEST DOES NOT CARRY (2026-08-26)

The same run measured `0 gold-standard artboard(s)` on the live droplet:
`loadDesignPanelArtboardExamples` reads bucket `wrap-files flat panel`, which is
**not populated on this project**, and it fails soft by design. Meanwhile the
closing line of every A.T.L.A.S. prompt said *"Match the production quality of
the provided gold-standard DesignPanel artboards"* — pointing the model at
images that were never in the request.

The live Call-1 teaching input does not come from that bucket. It is one
release-owned, hash-pinned solid-rectangle flat example from Flamingo
GenerationID `5b2eb96c-77b5-4705-8cad-fef00af677fe`, SHA-256
`20085eb547251d46c8113014108b088e35a4d41e2ce77b9a152b2786e79c37fa`.
The model sees that flat example and the current neutral target guide. It does
not see the historical installed Driver proof: canary `33389124918` proved that
finished-vehicle imagery teaches wheel wells, body anatomy and template
furniture back into the source. Dedicated role text forbids copying the
historical artwork, wording, logo, brand, palette, typography or industry.
Surface names/IDs are metadata-only mapping and must never render into the
canvas.

### 📏 REPRODUCING THE A/B

`.github/workflows/designiq-ab-precision.yml` (dispatch, `RUN_DESIGNIQ_AB`) is
the harness. It captures the COMPLETE assembled request for both calls before
Gemini and then executes them, so a design-quality argument can be settled on
the request rather than on impressions of the output.

Two things about it that are load-bearing:

- **It runs in the live runtime image, not on a host path.**
  `ops/Dockerfile.runtime` installs into `/app` inside the image, so the host
  release directory has no `node_modules` at all. `calls-1-7-seam.yml` still
  asserts `$release/runtime/node_modules/@supabase` and will fail the same way.
- **The control is transpiled from the vendored source, never re-described.**
  `scripts/build-control-prompt.mjs` slices the pure prompt half of
  `supabase/functions/design-panel-ai-generate/index.ts` and swaps only the Deno
  import header; the harness refuses to run unless the SLICED SOURCE still
  hashes to the pinned value. (2026-08-26: the guard used to hash the ASSEMBLED
  prompt, which embeds the brief — so any non-default payload tripped "control
  drift". It is source-based and unconditional now.) A drifted control is not a
  control.
- Arms are A / A2 / B / C (+ B-configured when the droplet model differs);
  `arms:` narrows a dispatch and the summary prints `imageRequestsExecuted`.
  `runtime_source: checkout` is the isolated acceptance route (RULE 0.26).

## 🎭 RULE 0.24 — THREE REFERENCE CLASSES, THREE AUTHORITIES (Trish 2026-08-26)

Mixing these roles is a design-drift mechanism, so they are locked in tests
rather than left to prose — `tests/designpro-reference-authority.test.mjs`.

| class | what it is | what it may teach | what it may NEVER do |
|---|---|---|---|
| **STRUCTURAL** | the one release-pinned Flamingo pure-rectangle flat example plus neutral target guide | how ONE cohesive wrap composition occupies six flat print-art rectangles | contribute installed vehicle anatomy, artwork, wording, logo, colour, brand, style, target geometry, visible labels or production authority |
| **CREATIVE** | the customer's own VisionBoard images | artwork authority under `exact_reference`; style authority under `style_inspiration` | — |
| **PRESENTATION** | the 3D proof example + Studio OS | vehicle presentation, camera, studio, photorealism, wrap realism | contribute artwork or redesign the customer's wrap |

Exactly one flat structural example is attached, and its hash plus historical
GenerationID enter the immutable example-set/reuse fence. The installed
Flamingo proof and historical Houdini pair are not Call-1 inputs. The flat
example teaches cohesive rectangular output only and never becomes creative or
production authority.

**Authority order for a 3D proof:**

1. the accepted A.T.L.A.S. source design — **ARTWORK** authority
2. YMM + the angle contract — **VEHICLE/VIEW** authority
3. the 3D example + Studio OS — **PRESENTATION** authority

`viewAuthorityFor` enforces (1) by hash: an authority not bound to the surface
source, or bound to the wrong surface, throws
`flat_atlas_view_authority_identity_mismatch`. A presentation example can never
pass that gate, which is what stops a render reference redesigning the wrap.

The classes stay apart in metadata too — `topologyExamplesApplied` /
`topologyExampleIdentities` versus `verifiedCustomerReferenceCount` — so a later
reader cannot mistake one for the other.

## 📐 THE PERSONA WILL BE MEDIUM-AWARE. NOT YET, AND NEVER VIA AN AI CALL. (Trish 2026-08-26)

DesignProAI's professional persona ultimately applies to vehicle wraps, WallPro /
wall wraps, window graphics and GraphicsPro. The creative layer today is
vehicle-hardcoded: 55 `vehicle` references in `runtime/designiq-prompt.cjs`, no
medium abstraction, and no wall/window/graphics authoring path in the runtime.

**Do not generalise those 55 references yet.** Vehicle DesignPro is what is
blocking, and it must be proven first.

**When it is done, two constraints are already fixed:**

- **Medium selection is deterministic and local.** Assemble the correct
  professional persona for the medium in code. Do NOT add an LLM
  classification or persona-selection stage — that is latency on the critical
  path before the customer sees anything, and RULE 0.20's one-source-design
  contract does not get a second AI call to decide who is designing.
- **One source-design AI authoring call stays one call.** VisionBoardIQ runs
  only when reference images exist, and it is the only additional AI stage the
  authoring path may carry.

## 🔗 RULE 0.17 — ONE PIPELINE. A.T.L.A.S. IS NOT A SIDE EXPERIMENT. (Trish 2026-08-23)

A.T.L.A.S. runs the **same** file-output chain as Standard. It was excluded from
the production handoff, which made it a dead end by construction: a master, six
separated surfaces, seven proofs, and then nothing to validate.

Both pipelines now reach the same idempotent handoff, behind the same seven-view
readiness check. The flat-first gate
(`designpro_flat_first_handoff_gate`) decides on **canonical-master acceptance**
(`metadata.masterQcPassed`), never on the atlas `production_eligible` column —
that column describes the atlas *layout* geometry, is false by design
(`calls-1-7-layout-only`), and production dimensions come from the GENIE manifest
at `manifest.resolve`. Conflating the two is why the gate could never open.

After purchase: `manifest.resolve` (GENIE) → `source.verify` →
`await_panelpro_preflight_qc` → `enhance.upscale` (Topaz, gated on the purchased
entitlement, skipped when unpurchased) → `output.build`.

## 🖼️ RULE 0.18 — THE THREE PRODUCTION SURFACES LIVE ON THIS SERVER

None of these may be re-implemented against `supabase.functions` or
`production_flow_assets`. They read the run through `dpApi` only, and
`tests/designpro-customer-path-seam.test.mjs` walks their whole import closure.

| Surface | Route | Module |
|---|---|---|
| RevisionStudioIQ — the product editor: design grid, seven-view carousel, GalleryMode, layered canvas, revision box, Production Layers, Logo Pack entice | `/revision-studio` | `pages/RevisionStudioIQ.tsx` + `ProductionFlowLayersCard.tsx`, sourced by `lib/revisionstudio-source.ts` and `lib/revisionstudio-flow.ts` |
| The job's server-artifact status view (NOT the product RevisionStudio) | `/designpro/jobs/:generationId` | `components/revisioniq/ServerRevisionStudio.tsx` |
| PanelPro branded studio — tool rail, canvas, seven view tabs | `/designpro/jobs/:generationId/panel-studio` | `pages/DesignProStudio.tsx` |
| PanelPro Studio board — per-side REAL DESIGN PROOF ∥ PRINT PANEL, approve side, preflight gate | `/designpro/jobs/:generationId/panelpro` | `pages/designpro/PanelProStudioBoard.tsx` |
| GENIE Universal Panelizer progress — step rail, glowing 7 sides, "when all panels glow it's a go" | `/designpro/jobs/:generationId/progress`, `/productionflow/:generationId` | `pages/designpro/GenieProgress.tsx` |

**The board is not a producer.** RestylePro's "Pull panel" / "Mirror from driver"
built panels in the browser; here Call 1 deterministically separates and stores
the six authored regions. Call 9 verifies and promotes those same bytes. A side
with no Call-1 panel is reported as server work, never hand-patched — adding
those buttons back is the second producer the one-sanctioned-chain rule forbids.

A side may display its canonical Call-1 panel as soon as it exists. Production-
promotion/QC state appears only after Call 9 verifies that same panel; a view
render alone never substitutes for either state.

## 🧞 RULE 0.19 — GENIE DEPLOYS ONLY WHEN THE PRODUCTION PACK IS ORDERED (Trish 2026-08-23)

`manifest.resolve` sits **after** `await_purchase`, never in the free entice run.
It resolves the true production dimensions and drives the progress page, and that
is paid work.

It used to sit second, in the free half, where it waits with
`wait_reason = genie_dimension_validation_required` until a human validates the
vehicle. So every run parked before the 2D proof or a single panel existed — one
sat there sixteen hours on 2026-08-23 — and **that, not a code bug, is why
RevisionStudio had no extracted panels.**

**The free half needs no validated production geometry.** Call 1 resolves the
design-time size of every side (`resolveFlatAtlasPreviewDimensions`) and cuts the
six panels to it with the 5″ bleed already in the layout. Those panels are what
RevisionStudio and PanelProStudio receive immediately. That
geometry is marked `calls-1-7-layout-only` precisely because it is the design
size, not the validated production size.

Because the entice run no longer resolves GENIE, it can no longer prove a
dimension manifest — so `create_designpro_production_workflow` requires only what
that run actually proves: a completed `pack.activate` and its immutable
source/artifact identity.

A parked stage is still never reported as a running one: the gateway projects
`waiting_for_genie_dimensions` with the candidate id and the pages link to
`/designpro/genie-qc`. **Never re-map a `waiting` stage onto `running`,** and
never auto-accept grounded candidate values to clear a queue — validating
dimensions is a human judgement about a real vehicle.

## 🎨 RULE 0.20 — A.T.L.A.S. CALL 1 IS THE INITIAL DESIGN GENERATION

Not a preview. Call 1 authors the canonical flattened master **and cuts the six
print panels from it**, each stamped with that side's trim/print inches and
square footage. Every one of the seven vehicle views is a projection of that
master, and those same dimensions are sent into `design-panel-ai-generate` so
each 3D side renders at its true proportion instead of a guessed one.

An A.T.L.A.S. run is therefore orderable like any other. Hiding the Order
Production Pack button, the Logo Pack, the proof actions or the Call 8 card
behind `!isFlatFirstDiagnostic` is the dead-end framing — it was written in five
places and is locked out by `tests/atlas-fail-fast.test.mjs`.

What stays refused: per-view regeneration. One master owns the whole proof set.

## 🔀 RULE 0.21 — THE ACCEPTED MASTER FANS OUT IMMEDIATELY, TO BOTH SURFACES AT ONCE (Trish 2026-08-25)

**A.T.L.A.S. is not a pretty flattened preview. It is the production source.**
The first A.T.L.A.S. AI design generation creates the ONE flattened master and
is the design authority. The moment that master is accepted it fans out — it
does not wait for a later UI to recreate or "pull" anything:

```text
A.T.L.A.S. FIRST AI DESIGN GENERATION
one flattened master / one design authority
        │
        ├──► deterministic split by surface
        │      driver · passenger · hood · roof · front · rear
        │      exact GENIE dimensions + 5" physical bleed on every side
        │
        ├──► those SAME surface regions condition the matching 3D proof views
        │
        └──► the SAME paired artifact set, published in parallel to
               RevisionStudioIQ   AND   PanelPro Studio
```

**No side independently redesigns the wrap.** RevisionStudio does not wait for
PanelPro and PanelPro does not wait for RevisionStudio: they are parallel
consumers of one server-owned lineage, never two workflows.

The intended relationship, for all six surfaces, is one row:

> **REAL DESIGN PROOF ∥ PRINT PANEL**

Left is that surface's 3D proof. Right is the deterministically separated
canonical Call-1 A.T.L.A.S. panel for that exact `surfaceKey` at GENIE
dimensions + 5" bleed — **never
an upload, never an AI regeneration, never a browser-made crop.** The pair is
bound by the same `generationId`, A.T.L.A.S. revision / `masterContentHash`, and
`surfaceKey`.

| surface | purpose |
|---|---|
| **RevisionStudioIQ** | revise/edit the approved design lineage and inspect its production artifacts |
| **PanelPro Studio** | validate the exact print panels beside the real 3D proof and release them through production QC |

**Neither UI is a producer.** Do not restore `Pull panel`, `Mirror from driver`
or manual `Upload panel` as the canonical workflow — those are browser-era
producer controls, and the server already holds the panel bytes cut from the
accepted master. This whole rule is a **handoff/wiring** statement; it is not
permission to redesign A.T.L.A.S.

### The acceptance test — this is what catches a fake "wired" state

> For one fresh generation, open the same `generationId` in RevisionStudioIQ and
> PanelPro Studio. Driver proof + driver panel must carry the same A.T.L.A.S.
> parent hash; repeat for all six surfaces. **If either UI shows an empty panel,
> an uploaded replacement, a different revision, or a generated substitute, the
> wiring is not complete.**

Where this already holds, and where it is enforced: `cutCallOnePanels` splits
the accepted master by `SURFACE_KEYS` with `sharp.extract` (no AI), stamping
`surfaceKey`, `sourceMasterHash` and the trim/print inches with `bleedInches`;
`viewAuthorityFor` **throws** unless a proof's authority hashes to the master and
matches `surfaceForProofView()`; the panel artifact publishes
`metadata.sourceMasterHash` and the view publishes
`atlasBinding.masterContentHash`, so both halves carry the binding to the UI.
PanelPro compares them per side and **refuses to approve** a pair that provably
came from different masters — locked by `tests/server-revision-studio.test.mjs`.

## 🏭 RULE 0.22 — PANELPRO STUDIO IS THE PRODUCTION CONTROL ROOM, NOT A SIX-CARD VALIDATOR (Trish 2026-08-25)

**PanelPro is TWO surfaces, and confusing them is how one gets rebuilt as the
other.** The canonical contract (2026-08-24, §6) names both:

| Surface | Route | File |
|---|---|---|
| The branded studio — tool rail, canvas, seven view tabs, upload/text/logo/adjust/layers/move/scale/rotate/arrange | `/designpro/jobs/:generationId/panel-studio` | `app/src/pages/DesignProStudio.tsx` |
| The production/QC board — proof ∥ panel per side, dimensions, hashes, human preflight, downstream artifacts | `/designpro/jobs/:generationId/panelpro` | `app/src/pages/designpro/PanelProStudioBoard.tsx` |

**⚠️ THAT TABLE IS STALE AT `/panelpro`. THE ROUTE IS THE ANSWER. (2026-08-26)**

`3bc41b6` moved `/designpro/jobs/:generationId/panelpro` onto
`AdminGeminiCompareStudio.tsx` deliberately, and said why in its own message:
*"The PanelPro route mounts the full Admin Studio, which opens the job the URL
names; the per-surface validator keeps its own path one level down."* So:

| Surface | Route | File |
|---|---|---|
| **PanelPro Studio — the internal QC/lineage control room** | `/designpro/jobs/:generationId/panelpro` | `pages/AdminGeminiCompareStudio.tsx` |
| The per-surface validator | `/designpro/jobs/:generationId/panelpro/surfaces` | `pages/designpro/PanelProStudioBoard.tsx` |

An earlier revision of this rule called `AdminGeminiCompareStudio.tsx` "unrouted
RestylePro import weight". It is routed, and it is the control room. **Determine
this from the route and its history, not from this table** — the table has now
been wrong in both directions, and `git log -L` on the route line settles it in
one command.

The board is a validator, not a second producer — but it IS the design team's
complete production workspace for one order, keyed by `generationId` · Design
Order ID / order number · Design ID (DID), and it must preserve the whole
chronological lineage.

### A.T.L.A.S. version history — every revision, never only the newest

V1, V2, V3, V4… all remain inspectable and downloadable. **Never silently
replace V1 when V2 is created.** Each revision shows: revision number · Design
ID · Design Order ID · date · exact timestamp · **the customer revision/prompt
text that produced it** · the A.T.L.A.S. master · master hash / lineage
identity · its 3D proofs · its production proof · its deterministic surface
panels.

### The complete asset set, each individually downloadable

Flattened A.T.L.A.S. master · every saved A.T.L.A.S. version · driver ·
passenger · hood · roof · front · rear panels · 5″ bleed versions · all
canonical 3D proofs · 2D Production Proof · logos / extracted branding ·
metadata + dimension sheet · panel dimensions · square footage / GENIE geometry
· production PNG · production TIFF · required production derivatives · QC and
approval metadata.

**Do not hide files behind only a final ZIP.**

**Every production panel and every Call 11 QC panel carries the PANEL DATA SLUG
on its bottom edge, and the PANEL MAP is its source (owner, 2026-09-02, from
Brice's print sample).** The slug is the design-side twin of the RIP's info
band: order, DID, generation, revision, customer, vehicle, surface, trim, print,
bleed, sq ft, hashes, density, build time, QC line — rendered by code from the
`panel-map` artifact, 1.5" outside the bleed on production PNG/TIFF/EPS
(verified by `output.verify`), 120 px on QC duplicates. Never on the canonical
Call-1 panel. The team reads it at preflight (`panelDataSlugVerified`) and at
final QC (`productionSlugVerified`); both keys are required by the gate RPC.
Contract: `docs/PANEL-DATA-SLUG.md`.

### PanelPro QC is HUMAN design-team QC, not AI scoring

The team verifies each output against the **actual vehicle template** and
confirms the panel will physically fit the real vehicle. Per surface: correct
vehicle/template · correct surface · correct dimensions · 5″ bleed · correct
design/revision · proof and panel from the same A.T.L.A.S. master · graphics
aligned to the real template · text/logo placement safe · nothing important
falling into openings or cut areas · production resolution and file integrity.

### ⚠️ THE MANUAL CORRECTION PATH MUST REMAIN — DO NOT STRIP IT

**No manual/browser panel GENERATION. Yes to controlled human production
CORRECTION and upload, with lineage and audit history preserved.**

That distinction is the whole rule. `Pull panel` and `Mirror from driver` were
browser-era *producers* and stay gone — the server already holds the panel bytes
cut from the accepted master. But when a deterministic panel does not fit the
real template, the designer must be able to:

1. download the panel;
2. correct/re-output it against the real vehicle template;
3. **upload the corrected production panel back into the SAME surface/revision
   lineage**;
4. retain BOTH the original system artifact and the corrected human-approved
   artifact, for audit history;
5. mark the corrected artifact as the active production artifact;
6. click Approved only after physical/template QC passes.

An agent reading "no Upload panel" out of context will delete a required
production function. One already did: a lock in
`tests/server-revision-studio.test.mjs` forbade the string outright and had to be
corrected. Forbid *generation*, never *correction*.

**How it is wired (2026-08-25).** A correction is its own artifact kind,
`corrected-panel`, recorded by `record_designpro_corrected_panel`
(`supabase/migrations/20260825000000_designpro_panelpro_corrected_panels.sql`)
against the exact `surface_key` and revision it replaces. It carries
`correctedFromPath`, `correctedFromHash`, `sourceMasterHash`, `correctedBy`,
`correctedAt` and a required reason; a correction with no Call-9-promoted
canonical Call-1 panel to correct is refused. The branded panel is **never touched**, so `source.verify`'s
exactly-six-distinct assertion still reads the same six rows.

`enhance.upscale` enhances the **active** artifact per surface — the newest
correction when one exists, the branded panel otherwise — and records
`humanCorrectedSurfaces` on the receipt. That is what makes the human gate real:
enhancing the panel the team rejected, while the correction sat unused in the
vault, would let the gate pass and the wrong artwork print.

### Approval → Production Pack → WrapBox

Once the human QC checks pass: freeze the approved revision and panel
identities · stamp the Production Pack Proof approved · record approver, date,
time, hashes and metadata · assemble the Production Pack · generate the
metadata/dimension sheet · ZIP the approved deliverable.

The ZIP carries at minimum the approved 3D proof set, approved 2D Production
Proof, metadata/panel-dimension sheet, approved production panels, TIFF and PNG
outputs, and the production/approval metadata — **plus any pack assets the
working implementation already supports.** After the ZIP is built and verified,
publish it to **WrapBox**, where the customer downloads it.

### Final acceptance

For one fresh generation, PanelPro Studio must show the whole lineage:

> Design Order → Design ID → V1/V2/V3… → prompt + timestamp → A.T.L.A.S. master
> → 3D proofs → 2D Production Proof → six panels → human/template QC →
> corrected upload if needed → approved Production Pack → ZIP → WrapBox

**Nothing in that lineage may be silently replaced, disconnected, or lost.**

## ⚡ RULE 0.23 — DRIVER SIDE FIRST, THEN ASK. (Trish 2026-08-25)

**The customer must not wait for seven proofs to see whether the design is
right.** A.T.L.A.S. renders Driver first and hash-verifies it before projecting
the other six, so a real look at the design exists about a minute before the set
is finished. The product asks there:

> **"Do you want to see all sides of this design, or revise it?"**

- **See All Views** reveals the remaining proofs the server is already rendering.
- **Revise This Design** opens `/revision-studio` immediately, against the same
  design lineage.

Neither button is a producer. Making the customer watch six more proofs before
they can say "change it" spends six renders on a design they have already
rejected — and a revision supersedes all of them anyway.

**What already holds, and must not be undone.** `runAtlasProofStages` runs
Driver alone, hash-verifies the accepted bytes through `hydrateDriver()`, then
projects the remaining six **concurrently** (`parallel: true`) from the same
frozen master. `waitForGeneration` polls every 2s and reveals each view the
instant it lands. Call 1 separates and stores the six authored regions
deterministically before any proof renders, so panel publication is never on
the AI critical path.

**Do not serialize the six projections to "reduce load", and do not hold a
finished artifact back for an all-or-nothing bundle.** Progressive publication is
the contract: RevisionStudio and PanelPro fill per surface as either half
arrives, and a panel appearing before its proof is correct.

Locked by `tests/server-revision-studio.test.mjs` and
`tests/designpanel-view-reveal.test.mjs`.

## ⛔ RULE 0 — OPTIMIZE FOR BEHAVIORAL PARITY, NOT ARCHITECTURE (Trish 2026-08-17)

**The screenshots in `docs/LAST-WORKING-STATE-2026-07-24.md` are the spec.**
The question is not "what is the elegant architecture?" — it is "how does the
app behave like the working product again?" Sessions burned weeks debating
design masters, surface masters, proof regions, synthetic masters and
view-vs-origin philosophy while the product behaviour stayed absent.

**Stop archaeology. Do not propose alternate manufacturing models. Do not
redesign the product.**

The operating invariant — for each of the six surfaces the system must produce
AND show: (1) an approved side proof, (2) a matched print panel, (3) a composed
2D proof sheet, (4) all six side outputs visible in the UI. The PRINT PANEL is
deterministically derived for **that same side** at GENIE dimensions with 5"
bleed — no AI re-render for manufacturing and no cross-side reuse. Passenger is
its own named Call-1 authority and must never be replaced by mirrored Driver
pixels, whether automatically or as a hidden operator shortcut. An operator
may request a new proof or customer revision under the existing lineage rules.

Full spec, acceptance criteria, measured starting position, and the A/B session
split: **`docs/BEHAVIORAL-SPEC.md`.**

### CALL-8 DIMENSION TOTALS USE ONE ROUNDING BOUNDARY (2026-08-31)

Production canary run `33389124918`, GenerationID
`083d2a70-edac-4e75-9caa-1336542baf7c`, reached Entice `proof.build` but
correctly deferred with `genie_total_square_feet_mismatch`. The six verified
surface dimensions summed to `305.53` square feet when raw areas were summed
and rounded once. The design-time manifest instead rounded each surface first
and summed those rounded values, producing `305.54`.

That one-cent mismatch was a contract-construction defect, not a GENIE geometry
failure and not a reason to change any panel dimensions. Both the design-time
manifest and Call-8 request must compute total square feet from the same raw
surface areas and apply `nearest-0.01-after-raw-sum` exactly once. The repair is
not accepted as live until its release is tested, merged, deployed and a fresh
authorized production run produces the Call-8 proof.

## 🔒 RULE 0.25 — DESIGNID COMPLETION CONTRACT (Trish 2026-08-17, verbatim)

> **DESIGNID COMPLETION CONTRACT**
>
> Calls 1–8 constitute the complete DesignPro design workflow for one DesignID.
>
> Calls 1–7 produce the original design and required approved views.
>
> Call 8 automatically produces the 2D Production Proof for that same
> DesignID/revision.
>
> After Call 8, the design is complete and frozen.
>
> Calls 9+ are manufacturing only and may not creatively regenerate or
> reinterpret the design.
>
> The frozen DesignID/revision is the authority for every downstream panel,
> logo asset, production file, ZIP and WrapBox delivery.

**One DesignID owns Calls 1–8.** The customer-approved DesignID/revision is
frozen after Call 8; everything after it is deterministic manufacturing of that
exact design. **No second design generation after approval. No independent
manufacturing artwork. No reinterpreting the brief downstream.**

Design cycle: Calls 1–7 create the design and all locked-angle customer views
under one DesignIQ identity → Call 8 completes the 2D Production Proof for that
accepted DesignID/revision using the same approved state and GENIE geometry.
**At that point design work is complete.** Then manufacturing:

| Call | Produces |
|---|---|
| **9** | byte/hash/lineage verification plus production-promotion receipts for the six existing **branded canonical Call-1 panels**; it creates no artwork and changes no bytes |
| **10** | logo asset registration/separation for that accepted design |
| **11** | **duplicate** the six Call-9-promoted Call-1 panels, remove the **logos** from the **duplicates only**, and push those six `qc-panel` duplicates to PanelProStudio for human sizing/template QC |

**The hard order: Design/Call-1 panels → views + Call 8 → Call-9 promotion → Separate/Register logos → Duplicate +
de-logo → PanelPro QC → Topaz → Final outputs → ZIP → WrapBox.** Topaz upscales
the *approved* panels after human/template QC passes on the de-logoed
duplicates. **No Topaz before PanelPro. No mutation of the Call-1 branded
panels, ever.**

The runtime's frozen `STAGES` list already puts `await_panelpro_preflight_qc`
before `enhance.upscale`, so that constraint holds today — do not reorder it.
Call 11 inserts between `logos.extract` and `await_panelpro_preflight_qc`.

**Two sets exist on purpose:** the branded canonical Call-1 panels are the untouched
production artwork; the de-logoed duplicates are the working QC/template
validation set. **Call 11 may never overwrite or replace the branded production
panel set.**

### CALL 11 — DE-LOGO DUPLICATE SET (owner contract, verbatim)

> Input: the six immutable branded Call-1 panels after Call-9 promotion.
>
> For each canonical side:
>
> 1. duplicate the exact branded panel;
> 2. remove the known logo regions from the duplicate only;
> 3. preserve the original branded panel byte-for-byte;
> 4. output six de-logoed QC panels;
> 5. bind each de-logoed panel to its source branded panel hash and surface_key;
> 6. push the six de-logoed panels to PanelProStudio for human sizing/template QC.
>
> Call 11 may never overwrite or replace the branded production panel set.

The runtime today emits no Call 11 and no duplicate stage, so **this is a real
gap against the intended product behaviour, not a numbering quibble.**

**OWNER DECISIONS — BLOCKERS CLOSED (2026-08-17). No further architecture
decision is required; implement by matching the proven RestylePro behavior.**

1. **Do not add Generation-side placement geometry** merely to implement Call
   11 — that is another seam redesign. Recover the proven RestylePro
   logo-removal/detection behavior and apply it to **Call 11 QC duplicates
   only**. Its constrained AI/logo detection **is allowed here**, because the
   output is a non-authoritative QC instrument, never production artwork.
2. **Call 11 removes logos.** A.C.E.-authored company name / contact / type
   treatment **may remain** — a phone number on a QC duplicate does not defeat
   a sizing check. **Do not expand Call 11 into general lettering/text
   removal.**
3. **`qc-panel` artifact kind approved.** Preserve the exactly-six panel
   invariant **unchanged** — never relax that assertion to make room.
4. Call 11 sits between Call 10 and `await_panelpro_preflight_qc`.
5. Topaz stays after PanelPro preflight and runs on the **authoritative branded
   production path**, never the QC derivatives.

Each `qc-panel` keeps its canonical `surface_key` and its source Call-1 panel hash,
and may never enter Topaz/output/ZIP as production artwork. The exact functions
to port (`locateBrandingElements`, `collapseContainedBrandingElements`,
`strictGeminiBox2d` in `restylepro-os` `worker/index.js`) and the dilation /
clamp / honest-no-op pattern that goes with them: `docs/BEHAVIORAL-SPEC.md`.

### 6A — do not fabricate separability that does not exist

**There is no authoritative pre-branding base artwork, and no session may
synthesize one.** Calls 1–8 emit a single composited raster per surface
(`proof.build:455`, `role: canonical-production-surface`), Call 9 consumes
those exact Call-1 bytes (`panels.build:513`, *"Consume, never cut"*), and the
revision snapshot carries no base-artwork field. Do not erase, inpaint,
regenerate, pixel-lift, approximate a clean background, or reclassify baked-in
artwork as an overlay after the fact. That is a frozen-seam violation, not a
Manufacturing workaround.

This is a standing prohibition, not an open question. **Call 11's `qc-panel`
duplicates are not that base** — they are derived downstream from the immutable
branded Call-1 panels in their Call-9-promoted state, are non-authoritative, are never printed, and are never
Topaz/output/ZIP inputs. They must never be relabelled as production artwork,
promoted into the output set, or allowed to overwrite the canonical Call-1 panel set.

## 🧊 RULE 0.5 — THE GENERATION ↔ MANUFACTURING SEAM IS FROZEN (Trish 2026-08-17)

Generation owns producing the approved per-side artifacts. Manufacturing/UI
owns consuming them and binding them to the production board and the
downstream deterministic flow.

**Neither session may unilaterally change the shape, naming, identity, storage
contract, or semantics of the approved side-render interface.** Manufacturing
adapts to the existing contract instead of reshaping generation output;
Generation preserves it instead of changing it for UI convenience.

**If you conclude the seam must change: STOP and report the proposed contract
change to the owner.** Do not coordinate a silent change with the other
session. Any seam change is an owner-level decision.

Frozen, by real name: `SURFACE_KEYS` / `surface_key` · content-addressed
`storagePath` in private `wrap-files` (never a URL) · sha256 `contentHash` ·
`revisionId` embedded in the path · receipt kind + `receipt_hash` ·
`source.verify`'s exactly-two-proofs / exactly-six-distinct-panels check, which
is what makes implicit mirroring impossible.

**Geometry is NOT on this seam** — dimensions resolve from the vehicle at
`manifest.resolve` via the GENIE manifest. Generation must not emit dimensions.

Enforcement points, the full frozen list, and what counts as a breaking change:
**`docs/SEAM-FREEZE.md`.**

### ⛔ AMENDMENT — SCHEDULING IS NOT PART OF THE FROZEN SEAM (Trish 2026-08-27)

RULE 0.5 freezes the **artifact contract** — shape, naming, identity, storage,
`source.verify`'s exactly-six/exactly-two counts. It does **not** freeze *when*
a downstream workflow stage is scheduled, and a session reading "the seam is
frozen" as "do not touch stage sequencing without asking" stalled real
orchestration work on that misreading.

**Owner directive, final: "The graph contract is already decided... Do not
stop again because an old rule describes the obsolete serial architecture.
Update the rule/contract to the graph architecture and continue."**

So, explicitly: **workflow stage dependencies, scheduling and the conditions
under which a workflow row is created are NOT an owner-level stop.** Wire them
to the graph model — each node's real data dependency, nothing more — and keep
going. What remains frozen is only what RULE 0.5 actually names above:
`SURFACE_KEYS`, storage paths, content hashes, receipt shape, the exactly-six
panel / exactly-two proof counts. Changing *those* is still an owner-level
stop. Changing *when a stage may run* is not, and never was — it was read into
the rule, not written into it.

**Applied immediately**, per the graph contract:
`handoff_designpro_generation_to_production` used to require the generation's
overall engine state to be `outputs_ready` — every one of the seven proof slots
accepted — before it would create the entice workflow at all. That gated
`panels.build` **and** `logos.extract` behind the slowest of seven independent
AI calls, which is exactly the global barrier the graph forbids, one layer
above the `claim_designpro_stage` predecessor chain already removed. A
flat-first (ATLAS) request now hands off on **master acceptance alone** — the
same evidence `designpro_flat_first_handoff_gate` already reported as
production-eligible on a read-only path that disagreed with the write path
gating it. See
`supabase/migrations/20260827120000_designpro_logo_extraction_does_not_wait_for_proofs.sql`.
A Standard (non-flat-first) request is unchanged: it has no master and no
panels, so `outputs_ready` remains its only gate.

## ⛔ RULE 1 — RESTYLEPRO IS THE REFERENCE IMPLEMENTATION. RECOVER BEFORE YOU INVENT.

**Applies to every session in this repository.** If a capability worked in
`Tdill1980/restylepro-os`, find that implementation and reuse it. Do not design
a new one.

Use restylepro-os as the behavioural and code reference for the last working
per-side manufacturing path. For every post-approval stage you touch here,
**first locate the corresponding proven implementation in restylepro-os and
compare them side by side**, then port the smallest proven behaviour that
closes the gap.

**Do not redesign** — port as-is:
per-side source binding · `proofRegion` provenance · `brandedMaster` /
`cleanMaster` relationships · deterministic side identity · GENIE geometry ·
logo separation · PanelPro handoff.

**Adapt only what the standalone boundary actually changes:**
persistence · auth · CAS/hash storage · durable stage execution · droplet and
runtime plumbing.

**Before writing code**, name the exact RestylePro file and function you are
using as the reference. If the standalone version differs, explain the delta
before you change it. If no RestylePro counterpart exists, say so explicitly —
that is what licenses new design, and it should be rare in the post-approval
half.

**Do not restore old infrastructure wholesale. Do restore the working logic.**

The goal is **working restylepro-os production behaviour inside the new
designproai-os operating-system contracts** — not new manufacturing behaviour
invented again.

Per-stage reference map (`stage_key` → RestylePro file/function), the frozen
list, and the one documented exception:
**`docs/RESTYLEPRO-REFERENCE-RULE.md`. Read it before touching a
post-approval stage.**

## 💾 A DARK DEPLOY THAT DIES ON "120 GiB FREE" IS A FULL DISK, NOT A BAD BUILD

`ops/install.sh` refuses to install below **120 GiB free on /opt**, and every
deploy attempt leaves an immutable release directory, a runtime+gateway image
pair (~730 MB) and a `/var/backups/designpro-cutover` snapshot behind. They
accumulate until the next release is starved.

The error reads `Host requires at least 120 GiB free on the /opt filesystem`
and exit code 3, in the *dark-deploy* job, **after** a green release gate — so it
looks like the change under review broke the deploy. It did not.

**The remedy is the repo's own workflow**, `disk-maintenance.yml`, dispatched
with `RECLAIM_DESIGNPROAI_DISK`. It deletes only DesignProAI-owned leftovers —
release directories and `designproai-*` images that no live `current`/`public`/
`restore` pointer references, and all but the newest three cutover backups — and
never touches the shared spool, env files, Caddy, or any non-DesignPro path.
Then re-run the failed dark-deploy job; nothing needs rebuilding.

Live on 2026-08-25: 116 GiB free blocked the deploy; the reclaim took the host
from 194 GiB used to 58 GiB, and the same artifact deployed unchanged.

## 🧬 PATCHING LIVE PL/pgSQL: VALIDATE THE RESULT, NOT ONLY THE SEARCH STRINGS (2026-08-26)

Two rules, and the second was learned the expensive way.

1. **Patch the live body; never restate it.** `20260822090000` text-patches
   `complete_designpro_stage` rather than re-emitting it. A migration that
   `CREATE OR REPLACE`s the whole function silently reverts every earlier patch —
   the shadow gate caught exactly that on the Close-Up boundary.
2. **Then parse what you produced.** `20260826010000` asserted each of its six
   search fragments appeared EXACTLY ONCE — and every assertion passed — while
   one replacement deleted the legacy `ELSIF v_stage.stage_key='panels.build'`
   header it was supposed to keep. Three symptoms followed and all three read as
   something else: a clean A.T.L.A.S. promotion fell into the orphaned legacy
   body, a mutated one still raised (masking the shape problem), and **a Standard
   run matched no `panels.build` arm at all and completed with no contract
   enforced.** Validating the inputs proves you found the right text; only
   inspecting the generated body proves you left valid code behind. The
   structural locks in `supabase/tests/atlas_stage_contract.test.sql` — A.T.L.A.S.
   arm present verbatim, legacy arm present verbatim, A.T.L.A.S. before legacy —
   are what that costs to prevent.
3. **And then RUN it, over a row that exercises the expression.** `20260826030000`
   wrote `pg_catalog.coalesce(...)` inside the `jsonb_agg` that projects each
   approved view. **COALESCE is SQL grammar, not a function in any schema** — the
   parser resolves it before a search path is consulted, so a qualified form
   cannot exist. It applied clean in shadow, applied clean in production, and
   passed every check, because **PL/pgSQL compiles an expression the first time
   it is EVALUATED, and an aggregate over zero rows evaluates nothing.** So the
   read returned a flawless `[]` for every generation whose proofs the sibling
   fence withholds — including the acceptance generation I verified against —
   and raised `function pg_catalog.coalesce(jsonb, jsonb) does not exist` for
   every generation that actually had proofs, which is the only case
   RevisionStudio exists to serve.

   `SET search_path = ''` is why qualifying is the right reflex, and it stays
   right for functions, operators and types. It does not apply to the grammar:
   COALESCE, NULLIF, GREATEST, LEAST, CASE, EXTRACT and the aggregate syntax
   forms take no qualifier and reject one. `grep -n "pg_catalog\.\(coalesce\|nullif\|greatest\|least\)" supabase/migrations/`
   finds this class in one command.

   Fixed by `20260826060000`; locked by
   `supabase/tests/generation_workspace_contract.test.sql`, which seeds SEVEN
   view rows and CALLS the function — a fixture with an empty view set
   reproduces nothing at all.

## 🪞 A POLICY RUNS AS THE CALLER, AND PRODUCTION HAS OBJECTS THE HISTORY NEVER CREATED (2026-08-26)

Two facts, learned together, because the second hides behind the first.

1. **A row-security policy expression is evaluated with the PRIVILEGES OF THE
   QUERYING USER.** So an inline `EXISTS` inside a policy can only read tables
   the caller could read directly. `designpro_generation_requests` and
   `designpro_qc_members` are service-role only, so a policy that reaches either
   of them from an `authenticated` session dies with
   `permission denied for table designpro_qc_members` — and it takes the whole
   read down, not just that branch. The remedy is the idiom the codebase already
   uses: a `SECURITY DEFINER` helper in `designpro_private`, whose body runs as
   its owner, granted `EXECUTE` to `authenticated`.

   Note what this means for `designpro_generation_requests`' own SELECT policy:
   its `designpro_qc_members` clause can never fire for a real caller, because
   nothing can select that table as `authenticated` in the first place. It is
   reachable only from a definer function.

2. **`designpro_private.caller_owns_generation(text,text)` exists in production
   and in NO migration.** `20260814160000` wrote that predicate inline; someone
   later refactored it into a function directly against the database. So a new
   policy that calls it passes every check against production and dies in the
   shadow apply — which is exactly what happened, on the first attempt at the
   RevisionStudio migration:

   ```
   ERROR: function designpro_private.caller_owns_generation(text, text) does not exist
   At statement: 18   CREATE POLICY designpro_owner_read_generation_views
   ```

   **Validating against production is necessary and not sufficient.** Production
   is a superset of the migration history, so it will accept references a fresh
   database refuses. Before depending on any function, check it is CREATEd in
   `supabase/migrations/` — `grep -rn "FUNCTION <name>" supabase/migrations/` —
   and if it is not, define your own in your migration rather than borrowing the
   drifted one. `designpro_private.caller_owns_generation_path(text,text)` is
   that in-history twin.

## 🚦 THE MERGE DOES NOT DEPLOY ITSELF, AND DISPATCHING THE GATE ON `main` KILLS THE ONE THAT WOULD (2026-08-26)

Two facts, learned in the same five minutes, and the second is invisible until
you go looking for it.

1. **`release.yml`'s concurrency group is `designpro-release-<ref>`, with
   `cancel-in-progress: true`.** A `workflow_dispatch` on `main` and the push
   gate from a merge to `main` resolve to the SAME group, because neither has a
   pull-request number. So dispatching the protected production migration right
   after merging **cancels the merge's own gate run** — and
   `deploy-production.yml` only auto-fires on
   `workflow_run.conclusion == success && workflow_run.event == push`, so a
   cancelled gate means the deploy is skipped, silently. Live on 2026-08-26:
   gate `32936283425` cancelled, deploy `32936295705` skipped.

2. **The auto-deploy path also requires an opt-in marker in the merge commit.**
   Its "Prove exact protected main intent" step runs
   `git log -1 --format=%B | grep -Fq '[dark-deploy]'` on the `workflow_run`
   branch. A merge commit without that literal string never deploys, however
   green its gate. This is deliberate: merging is not the same act as putting
   an artifact on the droplet.

**So the order that actually works** is: merge → dispatch `release.yml` on
`main` with `APPLY_DESIGNPRO_PRODUCTION` (it must be `main`; the job asserts
`test "$GITHUB_REF" = "refs/heads/main"`, which is why dispatching it on the
feature branch fails at the guard) → then dispatch `deploy-production.yml` on
`main` with `exact_sha` = main's head and
`DEPLOY_DARK_TO_DESIGNPROAI_PROD_SFO3`. The dispatch path asserts
`GITHUB_SHA == EXACT_SHA`, so it can only ever deploy the head of main.

**WAIT FOR THE PUSH GATE TO FINISH BEFORE DISPATCHING.** The cancellation is
symmetric — whichever run enters the group second kills the first — so the
order of the two mistakes is the only thing that varies. Both happened here
within half an hour:

| | dispatched | push gate | cancelled |
|---|---|---|---|
| `1cd0163` | 06:00:13 | 06:00:10 | the **push gate**, so the deploy had no artifact to consume |
| `1e9e29f5` | 07:28:27 | 07:28:35 | the **dispatch**, so the migration never ran |

A cancelled push gate is the more expensive of the two, because
`deploy-production.yml` selects its artifact with
`event=push&status=success` and asserts **exactly one** — cancel that run and
the dispatch deploy fails at *"Select the one successful exact-main release
run"* with a count of zero. Re-running the cancelled push gate restores the
count; nothing else does.

So: merge → **let the push gate go green** → dispatch the migration → dispatch
the deploy. Put `[dark-deploy]` in the merge commit only when the merge itself
should ship, and then do not dispatch anything until that gate has finished.

## Where things are

| | |
|---|---|
| Required behaviour + acceptance criteria + session split | `docs/BEHAVIORAL-SPEC.md` |
| The frozen cross-session seam | `docs/SEAM-FREEZE.md` |
| What the working system produced (the spec, in screenshots) | `docs/LAST-WORKING-STATE-2026-07-24.md` |
| Post-approval stage dispatch | `runtime/designpro-standalone-claimant.cjs` |
| Calls 1–7 port scope and named-surface authority | `docs/CALLS-1-7-PORT-SCOPE.md` |
| What ships first and what is unproven | `docs/GO-LIVE-READINESS.md` |
| Reference checkout | `restylepro-os` alongside this repo (clone it if absent) |
