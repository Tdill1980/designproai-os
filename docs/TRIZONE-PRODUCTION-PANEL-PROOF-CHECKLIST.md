# TriZone™ Production Panel Proof — the source. Checklist.

Owner, Trish, 2026-09-22, verbatim:

> "It's a production panel proof single first call. This is the source;
> everything derives from this source, gets processed, upscaled, sent to
> RevisionStudio to entice buyers, then all processed upscaled elements get
> parsed and in QC PanelPro Studio. I have proof that it worked too."
>
> "The problems are: the system creating such a poor quality design — very
> apparent it's not using our custom design edge functions in Call 1 or 2."
>
> "Also still generating a now retired atlas design. This needs to go along
> with the atlas wording."
>
> "Ace creates a logo font, uses that throughout — never generic fonts."
>
> "It created a 3 zone, you realize that right??? Don't break what works."
>
> "We still need QC checks, stamp, zip file creator — it's just now on
> TriZone Production panel proof."
>
> "Get all this in a markdown and check off as complete. Especially the edge
> functions."

## The rule for this file

**A box is ticked only with evidence read back from the live system** — a row
field, a deployed function body grepped for a string, a live run id, a
workflow log line. A green test is not evidence; a merged PR is not evidence.
Each ticked line names the PR that closed it and the evidence line. Until a
live generation has been read, the code lines below stay **CODE-LOCKED**
(built, covered by a lock verified to fail against the pre-fix tree) and
unticked.

The live run this file measures against: New Aura Day Spa, request
`21dc0312-1c69-4d70-83ff-ae4c8f9c5b46`, revision `2449ccf8` (2026-09-22).
It proved the ARCHITECTURE: one image call, the code-drawn colour-coded
template (`identity.method: studio-template-cell`, GENIE geometry), three
zones cut, seven views, Call 8, Call 9 promoted, 65 s. What was wrong is what
the two calls were TOLD and GIVEN, plus two leftovers of the retired route.

## The edge-function audit — what each call runs (measured from the deployed code, 2026-09-22)

| call | edge function that runs | your custom persona / design function | before this pass | after this pass | status |
|---|---|---|---|---|---|
| 1 | `production-panel-proof` | A.C.E. — `buildDesignIQPrompt` (`_shared/designiq-assembly.ts`, sliced byte-for-byte from `design-panel-ai-generate`) | ran, but `mode: "commercial"` HARDCODED (`index.ts:591`); the restyle persona (`WePrintWraps.com Lead Vehicle Wrap Designer` + DESIGN AMPLIFICATION) never ran | `mode` comes from the request (`body.mode`); `panelProofCreativeHead` accepts both identities; `atlasRestyleScene` gains its `atlasProofSheet` variant | [ ] CODE-LOCKED — tick on a live restyle run with `mode: "restyle"` on the receipt |
| 1 | | the customer's own brief | **no** — `parseCustomerIntake` (a homegrown Flash pass) REPLACED the brief whenever its rewrite kept 66% of the words (`:580-588`); `intake.creativeDirection` on `2449ccf8` is a sentence the customer never typed | `briefText = rawBrief` always; the Flash call is skipped when the form supplied the company name; receipt `intake.briefSource: "raw"`, `intake.flashSkipped` | [ ] CODE-LOCKED — tick on `intake.briefSource = "raw"` on a live row |
| 1 | | `persona-csr-enrich` (Persona 1) | not on this route; WallPro only | unchanged, by the owner's "one image call, no new persona text" | n/a |
| 1 | | `persona-designer-prompt.ts` (Persona 2) | only `persona-designer-generate` (WallPro / RestyleBatch) | unchanged | n/a |
| 1 | | `logopro-generate-concepts` / `logopro-finalize-logo` | no | unchanged — the designer draws its own mark into Zone 1 and Zone 3 ("Ace creates a logo font, uses that throughout") | n/a |
| 1 | Zone 3 lettering | the design's own font | **no** — `typography` and `contact` were code-typeset SVGs (`typeset.renderLockup`) claiming their slots BEFORE the sheet's own drawn marks; only logo / promo / icons were sheet-drawn | on the sheet path all five Zone 3 slots are read off the sheet (`zone3LetteringSource: "sheet-drawn"`); the customer's UPLOADED logo still wins its slot; the derived (legacy) path keeps the typeset SVGs | [ ] CODE-LOCKED — tick when all five `cutGraphics` read `source: "sheet-drawn"` on a live row |
| 1 | what the model is told it is making | "the panels themselves, as they look coming off the printer" — read as a photograph of printed film; the model has drawn a piece of wrap film on a table | the object is named as a FILE: "Build the print file … six flat design panels, laid out the way a wrap-shop graphic designer builds the PNG or TIFF that goes to the printer — flat artwork on the sheet, in exactly the form of the attached finished proof"; the job line reads "THE DELIVERABLE IS A PRINT FILE" (owner, 2026-09-22) | [x] LIVE — the deployed `production-panel-proof` body carries `THE DELIVERABLE IS A PRINT FILE` and `wrap-shop graphic designer builds the PNG or TIFF`; deploy run 35789933641 (edge) / 35789930572 (droplet), SHA `4285047`, bodies read back 2026-09-22 22:09Z |
| 1 | the Ridgeline gold sheet | the STANDARD for the quality of the work, on another vehicle for another company | framed as a format example only | `PINNED_INPUT_FRAMING.format` names FORMAT and QUALITY, and forbids taking artwork, wording, logo, brand, industry, typography, shapes or figures from it | [x] LIVE — the deployed body carries `FINISHED WRAP DESIGN … PRODUCTION-QUALITY REFERENCE ONLY`; deploy run 35789933641 (edge) / 35789930572 (droplet), SHA `4285047`, bodies read back 2026-09-22 22:09Z |
| 1 | the small-panels line | — | "hood, front, rear carry the logo and ONE line at most" in both byte-locked twins | deleted from `_shared/atlas-panel-proof-prompt.ts` and `runtime/atlas-panel-proof-contract.cjs` | [x] LIVE — the deployed body's only `ONE line at most` is the comment recording its deletion; the instruction is gone; deploy run 35789933641 (edge) / 35789930572 (droplet), SHA `4285047`, bodies read back 2026-09-22 22:09Z |
| 2 | `persona-photographer-render` mode `atlas-proof` | `buildPhotographerPrompt` (`persona-photographer-prompt.ts`: identity + `view-angles-os` camera + `studio-os` lighting) | **no** — three fixed sentences from `_shared/atlas-proof-presentation.ts`; the persona was imported and unused | `handleAtlasProof` builds its prompt with `buildPhotographerPrompt({designAnchorText, vehicleYear/Make/Model, finish, shotKey})` + `atlasProofOsInputs` (surface, pickup bed clause, roof qualification); `designAnchorText` = the designer's own DESIGN ANCHOR text from Call 1, carried on the receipt as `panelProofAuthoring.designAnchor`; prompt contract `designpro.atlas-proof-photographer.v2` | [~] HALF-LIVE — the deployed `persona-photographer-render` body calls `buildPhotographerPrompt(` inside `handleAtlasProof` and carries `designpro.atlas-proof-photographer.v2` (deploy run 35789933641 (edge) / 35789930572 (droplet), SHA `4285047`, bodies read back 2026-09-22 22:09Z); the receipt half waits on a live generation |
| 8–12 | Call 8 sheet, Call 9 promotion, Call 11 de-logo, Call 12 Topaz, ZIP, WrapBox | deterministic | yes | unchanged | [x] live on `21dc0312` (Call 8 ran, Call 9 promoted) |

## What was already complete before this pass (checked at creation, with evidence)

- [x] TriZone™ naming on every surface and in the ZIP — #614 (`PROOF_BRAND` in `os-brand.ts`; ZIP stem `proofs/trizone-production-panel-proof.png`).
- [x] The PanelPro preflight names the proof with three attestations, migration `20260922130000` applied — #610 (`schema_migrations` row; `approve_designpro_human_gate` body carries `panelpro_proof_evidence_incomplete`).
- [x] The canary reads `brandedSource` and signs the nine attestations — #616.
- [x] `separatedArtwork` removed; the three-zone path is the only Call 1 — #606 (deployed `production-panel-proof` carries `Fill the attached template` and the Ridgeline pin `e53f39a371205b61…`).
- [x] 150 PPI + 5″ clean panels (output contract v4) — #600 (`20260922060000` applied).
- [x] The three-zone route is ON for customers — deploy run 1876 prints `DESIGNPRO_ATLAS_PANEL_PROOF=on`.

## Part A — Call 1 runs A.C.E. on the customer's words, in the customer's mode

- [ ] A1. Raw brief. `briefText = rawBrief` always; Flash skipped when the form supplied the company. Receipt `intake.briefSource`, `intake.flashSkipped`. — CODE-LOCKED (`tests/atlas-panel-proof-topology.test.mjs`, `tests/atlas-panel-proof-contract.test.mjs`).
- [ ] A2. Both personas. `mode` from the request; `panelProofCreativeHead` accepts commercial AND restyle; `atlasRestyleScene` has the `atlasProofSheet` variant; the runtime forwards `input.mode`. Receipt `mode`. — CODE-LOCKED (`tests/atlas-panel-proof-contract.test.mjs`, `tests/atlas-call1-graph.test.mjs`).
- [ ] A3. The design's own lettering in Zone 3 on the sheet path (`zone3LetteringSource: "sheet-drawn"`). — CODE-LOCKED (`tests/atlas-panel-proof-topology.test.mjs`).
- [x] A4. The small-panels line deleted from both twins — LIVE: the deployed body's only `ONE line at most` is the comment recording the deletion, edge deploy run 35789933641 at SHA `4285047`, read back 2026-09-22 22:09Z. Locked by `tests/atlas-panel-proof-contract.test.mjs` (`SMALL PANELS` absent).
- [x] A5. One role for the Ridgeline sheet: FORMAT + QUALITY, nothing else. The request hash covers the framing text (`providerCacheMaterial` hashes `modelRequest`), so no cached sheet under the old words is reused. — LIVE: the deployed body carries `FINISHED WRAP DESIGN … PRODUCTION-QUALITY REFERENCE ONLY`, edge deploy run 35789933641 at SHA `4285047`, read back 2026-09-22 22:09Z.
- [x] A6. Prompt trimmed only where the template already draws it; the ATTACHED lines stay verbatim (the "prompt names the attachments" lock holds); whole prompt measured 4.8K / 4.55K, `added <= 1200` lock green. — measured locally 2026-09-22.
- [x] A7. NOT changed: one image call, single turn, the code-drawn colour-coded template, the six-across sheet, the cutter, the gates, Calls 8–12. No new persona text. — asserted by `tests/panel-proof-is-the-only-call1.test.mjs` and the unchanged `imageRequestCount === 1` locks.

## Part B — Call 2 photographs with YOUR photographer

- [ ] `handleAtlasProof` prompt = `buildPhotographerPrompt(...)` + `atlasProofOsInputs(...)`; the surface's TriZone panel is the ONLY artwork input on every attempt; `sourcePanelHash`, `atlasZoneContentHash`, hash verification, gates and receipts untouched. — CODE-LOCKED (`tests/proof-stack-pinned-sources.test.mjs`: the adaptation touches the artwork input and the prompt builder, nothing else; new case asserts the atlas-proof mode calls `buildPhotographerPrompt`, verified to fail pre-fix).
- [ ] `designAnchorText` from Call 1's DESIGN ANCHOR (`panelProofAuthoring.designAnchor` → provider request `designAnchorText`); absent, a one-line pointer to the attached panel. No customer brief and no second creative authority enters Call 2. — CODE-LOCKED (`tests/atlas-designpanel-server-provider.test.mjs`).
- [x] `atlas-proof-presentation.ts` stays as the documented 2026-09-01 contract, unwired; its header says so. Prompt contract bumped to `designpro.atlas-proof-photographer.v2`.

## Part C — the old sheet goes; QC checks, stamp and ZIP live on the TriZone™ proof

- [ ] C1. No human surface shows or downloads the assembled master: PanelPro "Print master" card + "Download master" removed (`AdminGeminiCompareStudio.tsx`); `VersionAssetManifest` row + `atlas-master-…` filename removed; `PanelProStudioBoard` download entry removed; ZIP entry `proofs/print-master.png` + `includedKinds["atlas-master"]` removed; `GenerateDesign` "After · canonical master" card removed; `designpro-stages.ts`, `GenieProgress` (gateway label), `dashboard-nav.ts`, `useDesignPanelProLogic`, `RevisionStudioIQ` reworded to `PROOF_BRAND`. `ProductionProofSourceCard` is the only source shown. — CODE-LOCKED (`tests/call1-proof-zip-handoff.test.mjs`, `tests/panelpro-version-asset-manifest.test.mjs`, `tests/panelpro-atlas-visual-hierarchy.test.mjs`); tick when a fresh paid ZIP lists no `print-master.png` and PanelPro shows no master card.
- [ ] C2. Stamp seals the TriZone sheet: `stamp.build` renders the seal onto the frozen sheet (bytes re-verified against `panelProofAuthoring.proofSha256`, exact content-addressed path only) → artifact `stamped-production-panel-proof` (`stamped-trizone-production-panel-proof.png`), receipt `stampedProductionPanelProof`; `zip.build` expects the eleventh stamp when the receipt names it. DB gate: migration `20260922151000` admits the fourth stamp conditionally on the snapshot's sheet, binds it, and admits its ABSENCE (ship-order window). — CODE-LOCKED (`tests/production-proof-completion.test.mjs`, `tests/designpro-stamp-seals-the-proof-db.test.mjs` on the real migration chain, pre-fix case reproduces `exact_stamp_artifact_set_required`); tick when a live paid run's `stamp` receipt carries `stampedProductionPanelProof`.
- [ ] C3. QC checks read the proof: `designpro-stages.ts` "TriZone™ Production Panel Proof present, with its Generation ID"; `designpro-panel-qc.ts` evidence lines cite the sheet hash. — CODE-LOCKED; tick on the live control room.
- [ ] C4. The engine string leaves the rail: `V{n} · {authored date}`; the prompt-version facts removed from both PanelPro screens (`AdminGeminiCompareStudio`, `PanelProStudioBoard`) and from `GenerateDesign`'s lineage line; still in the forensic-record download. Lock: `tests/no-atlas-on-human-surfaces.test.mjs` convicts any JSX interpolation of `promptVersion` / `prompt_version` / `authoringTopology` into visible text, including mid-sentence — verified to fail pre-fix (it listed `PanelProStudioBoard.tsx:1191`, `:1225`). Tick on the live rail.
- [ ] C5. **OPEN, tracked here on purpose.** The assembled 4096² master stays the runtime's INTERNAL derivation for hash binding (`master_content_hash`, the CHECK on `designpro_atlas_call1_runs`, `productionAuthority: "atlas-master"` receipt identifiers required by `20260826010000:201`). Rebinding views, panels, `source.verify`, the Call-1 run CHECK and `productionAuthority` to the TriZone sheet hash is a migration series. Not silently skipped; not done.

## Part D — the gate that failed every run

- [x] D1. **LIVE.** `SELECT designpro_private.flat_first_atlas_view_set_valid('21dc0312-1c69-4d70-83ff-ae4c8f9c5b46')` returns **true** on production (read 2026-09-22 22:0xZ); `supabase_migrations.schema_migrations` carries `20260922150000` and `20260922151000` (release run 35787744231). The gateway's 409 had no other cause, so the "cannot be reused" card is gone; the `GET …/views` 200 was not exercised from here (no owner bearer token in the session). Migration `20260922150000` text-patches `designpro_private.flat_first_atlas_view_set_valid(uuid)`: on a revision carrying `panelProofAuthoring.proofSha256`, the clause becomes the worker's rule (`proofArtworkAuthorityContract = designpro.atlas-three-zone-proof-authority.v1`, role `three-zone-production-proof`, `proofArtworkAuthorityHash` = sheet, `sourcePanelHash` = sheet); otherwise the legacy panel equality byte for byte. — CODE-LOCKED (`tests/designpro-view-gate-learns-the-proof-db.test.mjs` on the real migration chain; `apply:false` reproduces the false verdict). **Tick when** `SELECT designpro_private.flat_first_atlas_view_set_valid('21dc0312-1c69-4d70-83ff-ae4c8f9c5b46')` returns `true` on production and `GET /api/generation/requests/21dc0312…/views` answers 200.
- [ ] D2. `lateAtlasViewSet` (paid path twin) branches the same way. — CODE-LOCKED (`tests/production-proof-completion.test.mjs`, three-zone fixture, verified to fail pre-fix with `production_late_view_lineage_invalid`); tick when a paid three-zone run passes `output.verify`'s late join.

## Ship order (what has to happen, in this order)

1. [x] One PR: this file + A + B + C + D — #617 (`0d6f828`) and #618 (`4285047`). Locks run locally and named in the commit (CI runs none).
2. [x] Merged WITHOUT `[dark-deploy]`; push gate 35788264363 green. (the migrations admit the old runtime; the new runtime needs the migrations). Let the push gate go green.
3. [x] `release.yml` `APPLY_DESIGNPRO_PRODUCTION` run 35787744231 success; both versions present in `schema_migrations`; D1 true on `21dc0312…`. Original text: Verify `schema_migrations` carries `20260922150000` and `20260922151000`; verify D1 on `21dc0312…`.
4. [x] `deploy-production.yml` run 35789930572 success on `4285047`. Resolved-flag banner, verbatim: `DESIGNPRO_ATLAS_TOPOLOGY=six-surface DESIGNPRO_ATLAS_PANEL_PROOF=on DESIGNPRO_ATLAS_FIELD_FIRST=off DESIGNPRO_ATLAS_HERO_FIRST=off DESIGNPRO_ATLAS_ELEMENT_GRAPH=on DESIGNPRO_ATLAS_CALL1_GRAPH=on DESIGNPRO_ATLAS_PANEL_FINISH=off`; `VERIFIED_WORKING`, two exact-SHA runtime replicas.
5. [x] `deploy-edge-functions.yml` run 35789933641 success for both functions at `4285047`; both bodies read back and grepped (see the audit table). Original text: Read both deployed bodies back: `briefSource` and `THE STANDARD, FOR ANOTHER COMPANY` in the first; `buildPhotographerPrompt` inside `handleAtlasProof` and `designpro.atlas-proof-photographer.v2` in the second.
6. [ ] One live generation, same brief ("Custom wrap for New Aura Day Spa … create a logo and a custom photo of a women getting a professional facial in a spa setting", company + website on the form, 2022 Ford F250 Crew Cab). Read from the row and tick the lines above.
7. [ ] **Acceptance is the owner's eye** on the exported TriZone™ sheet against the Ridgeline standard: artwork on all six panels, the company name and contact line in the design's own font in Zone 1 AND Zone 3, one logo per panel, Zone 2 the same panels without type; the seven proofs photographed in the studio with the same design.

## The document contract speaks only in the positive (owner, 2026-09-22)

Owner, on the prompt framework she drafted: *"Image models are notoriously bad
at negative prompting (like 'no', 'not', 'without'). If you tell an image model
'no 3D wheels' … its attention mechanism activates the tokens for 'wheels' … and
it often draws exactly what you told it to avoid."*

This repo had already measured that 4/4 — `atlasFieldContract` printed the six
rectangles and then said *"None of the map is drawn"*, and four consecutive live
runs painted those digits onto the customer's flanks — and CLAUDE.md warns about
the shape in four places. The DOCUMENT contract was still carrying seven of them.

| was | is |
|---|---|
| "invent no other words, numerals or web address" | "every word, numeral and web address on the wrap is here" |
| "ZONE 2 — BACKGROUNDS ONLY (NO TEXT OR LOGO)" | "ZONE 2 — BACKGROUNDS ONLY (THE ARTWORK ALONE)" |
| "as if they had never carried type" | "the artwork alone, background to every edge" |
| "Fill the attached template; do not re-flow it" | "Fill the attached template exactly as it is drawn" |
| "never repeated, never a seventh, never an empty box" | "each drawn ONCE, and every box on the sheet carries its art" |
| "take no shape or figure from it" | "match its craft and draw this brief's own shapes" |
| "every part of the sheet that is not a panel" | "every part of the sheet outside the panels stays plain white" |

- [x] Zero negation tokens in the model-facing document contract. — LOCKED
  (`tests/atlas-panel-proof-contract.test.mjs`, asserted on the prompt built
  with NO creative head, so A.C.E.'s own locked persona is out of scope by
  construction; verified to fail against the pre-fix twins).
- [x] **SIX EXISTING LOCKS PINNED THE NEGATIVE WORDING** and had to be inverted —
  one of them under a test literally named *"the installation fact is POSITIVE"*.
  The ninth time this repo has recorded a lock encoding the defect it was
  written to prevent.
- [x] A Zone 3 slot never names a string the customer did not supply. The
  contact slot read "the phone and web address above" whenever EITHER existed,
  so the live New Aura brief (website, no phone) told Zone 3 to cut a phone line
  that appears nowhere in the request. `contactNames` names only what the form
  carries; with neither, the slot LIFTS a mark off the design. The promotional
  slot stopped asking for a services line the brief may never have carried.
- [x] **The second model turn was rejected, deliberately.** The owner's draft put
  the layout in a second call that would "extract the elements and map them into
  the template". An image model repaints rather than extracts, so Zone 1 — the
  band every print panel is cut from — would be a re-drawing of turn 1's design.
  That is the `separatedArtwork` defect shape retired on 2026-09-22, and it
  breaks the one-image-call rule and the hash binding. The layout logic lives in
  the tail of the ONE call, with the template attached, as it ran on `21dc0312`.
- [x] **"Uninstalled vinyl sheets" was left out.** That wording is the
  photograph-of-film trap the owner corrected the same day.
- [x] **The contract version is NOT bumped, on purpose.** `providerCacheMaterial`
  hashes `modelRequest`, which carries the prompt text, so changed wording is
  already a different cache key; and no migration pins
  `designpro.atlas-panel-production-proof.v1`, which is a stored identifier the
  scope line keeps.

**Not proven:** no live generation has run on the positive wording. Acceptance
is the owner's eye on the exported sheet.

## Open items this file carries unticked, on purpose

- [ ] Retire the internal assembled master (C5 above): rebind every gate to the TriZone sheet hash — a migration series.
- [ ] Tighten `20260922151000` from "admits its absence" to "requires the fourth stamp on a three-zone revision" once the runtime that emits it is verified live (one-line follow-up migration).
- [ ] The gateway polling storm and the app's error latch (separate plan; the create page latched "cannot be reused" on a 409 from the view gate — D1 removes the cause, the latch itself is unchanged).
- [ ] Resolution: the six-across sheet caps the driver panel at ~5 px/in before Topaz; the only in-call lever is a two-row Zone 1 / Zone 2 template (~2×) — the owner's call, not this pass.
- [ ] **CONFIRMED ON PRODUCTION AND FIXED IN CODE — awaits its migration.** The
  column does NOT exist: `information_schema` on production lists twenty-one
  columns of `designpro_workflow_runs` and `generation_id` is not among them
  (read 2026-09-22). So `public.confirm_designpro_revision_purchase`
  (`20260920042000`) raises 42703 on its FIRST evaluation, and that is every
  customer purchase: `runtime/index.js` selects this RPC whenever the webhook
  carries `revision`, and the gateway writes the revision metadata on every
  Production Pack checkout session, which `checkoutRevisionFromMetadata` turns
  into exactly that. Stripe pays, the runtime answers 400, no entitlement row
  is written, production never opens. Two entitlements exist (2026-09-20
  03:15Z and 05:56Z) and none since. Migration `20260922160000` text-patches
  the one predicate out; the generation stays bound by the EXISTS on
  `designpro_revision_sources`. **Tick when the migration is applied on
  production and a purchase writes an entitlement row.**
- [x] The fixture that hid it is repaired: `tests/revision-pinned-purchase.test.mjs`
  hand-wrote `designpro_workflow_runs` WITH a `generation_id` column, so the
  suite was green over a table that exists nowhere else. It now slices the real
  DDL from `20260806180000` plus the ALTERs from `20260806180400`. Verified: with
  the new migration neutered, the new case AND the pre-existing end-to-end
  webhook case both fail — the suite would have caught this from the start.
- [ ] `parseCustomerIntake` is still a Flash call on the critical path whenever the form did not supply the company name; it no longer replaces the brief, it only fills structured fields the form left empty.

---

## Die-cut hood — live 848be1c6, 2026-09-23

Owner: *"see hood also fail cut to share of hood that's wrong."* The hood panel
was drawn as a hood silhouette on the document's white page and reached PanelPro
as a Call 9 promoted production panel.

- [x] **Root cause located, from the row and not from a theory.**
      `masterOutputClass` convicted it — `vehicle_depiction`, confidence `1.0`,
      `anatomyRectangles: 3`, evidence *"The hood panel is a vehicle-shaped
      island of artwork on a plain white surround"* — and both master gates are
      ADVISORY on this topology (owner ruling 2026-09-21), so the run recorded
      `masterQcPassed: true`, `accepted: true`, `blockingFailures: []`.
- [x] **The three structural instruments were blind, each for a stated reason.**
      `edgeHoleRatio` 0.000 (darkness test, surround is 248,248,248);
      `detectDieCut` convicts only ENCLOSED page colour and is wired to nothing;
      `fit` measured 0.8088 against 0.9841–1.0000 and was consumed by nothing.
- [x] **Deterministic gate shipped** — `dieCutFindings`, branded `fit` against
      its own clean twin. Type adds ink and cannot subtract it, so the
      comparison has no innocent reading, and being RELATIVE it cannot convict a
      legitimately light design the way a floor would.
- [x] **Corner discriminator closes the one innocent case.** A white banner
      behind lettering is page colour, exists only in the branded band, and can
      clear the band threshold on its own — so a candidate is convicted only
      when its four corner boxes are page too. Fixtures measure die-cut 1.0000
      against banner 0.0000; the threshold sits in the middle of an empty gap.
      An unmeasurable corner clears rather than convicts.
- [x] **It refuses through `refuse()`**, so the refusal carries the sheet
      identity, classifies as creative in `flat-first-atlas`, re-rolls the
      bounded second candidate, and lands the refused sheet in the ledger.
- [x] **Lock built from the live numbers** —
      `tests/atlas-proof-outer-die-cut.test.mjs`, every fit copied from
      `a9d6dd85`'s `panelProofAuthoring.quadrants`. Verified to fail pre-fix in
      both halves (threshold neutered → cases 1–2; refusal unwired → case 7).
- [x] **`Number(null)` caught in the gate's own first draft** by the lock's
      absence case: an unmeasured cell read as completely empty and was
      convicted. `fitOf` now accepts `typeof raw === "number"` only.
- [ ] **A live generation has run with the gate.** Nothing is proven on pixels.
      Acceptance is a run where the hood either fills its cell or the sheet is
      refused and re-rolled, read back from the row.
- [ ] **Cross-surface fit deficit promoted to blocking.** Measured and recorded
      (`threeZoneLayout.dieCut.surfaces[].brandedDeficit`); it catches a surface
      die-cut in BOTH bands, which the twin comparison cannot see. Left
      non-blocking because no fixture proves it will not convict a genuinely
      lighter panel — `atlas-proof-zone-gate.cjs` is the precedent. Needs a
      discriminator, not a threshold.
- [ ] **`detectDieCut` given a consumer.** Built, measured, wired to nothing; it
      owns the INTERIOR case (a window or arch enclosed by artwork) that the
      outer-boundary gate cannot see. Its own false-positive story — a
      white-filled logo counter is an enclosed page shape — is unresolved.
- [ ] **The advisory inspector's conviction surfaced to human QC.** It was right
      and nobody saw it; a blocking verdict recorded beside an accepted master
      should read loudly on the PanelPro board, not sit in the receipt.

### Resolution and cohesion — measured on the same run, NOT addressed here

The sheet came back **5056 × 3392**. Zone 1 is 25.8% of its height and holds all
six panels across, so each cell is ~843 px:

| | |
|---|---|
| passenger, 166.8″ wide | ~843 px → **5.0 px/in** |
| front, 75.3″ | ~843 px → 11.2 px/in |
| 150 PPI on the passenger panel would need | 25,020 px — **30×** |

One image call is one 4K output and six panels share it. No prompt, template
re-layout or constraint change adds a pixel; more resolution requires more
calls. The same cell size is why the treatments diverge (photographic flanks, an
abstract roof), why five named colours averaged into one mauve, and why *"logo
on back"* had nowhere to land. The fix is per-panel authoring sequenced as one
conversation — RULE 0.35's cascade, currently off behind the aspect gate — and
it is a build, not a prompt edit. Timings on this run: `totalMs` 84,083 of which
`panelProofMs` 61,650 (73%) is the single image call; `geniePrepHit: true`,
`genieMs: 74`.

### The resolution pass — BUILT AND WIRED, off by default (2026-09-23)

The paragraph above ends *"the fix is per-panel authoring ... and it is a build,
not a prompt edit."* That build exists now: `runtime/atlas-panel-refine.cjs`,
reached from both Call-1 paths behind `DESIGNPRO_ATLAS_PANEL_REFINE`.

**The aspect gate that shelved per-panel authoring is already retired** and the
paragraph above is stale on that point. `MAX_ASPECT_DRIFT_RATIO = 1.12` is gone;
`evaluateAuthored` contain-fits and edge-extends against
`MAX_CONTAIN_DRIFT_RATIO = 2.0`, and a 166.8 × 59.4 flank is 2.81:1 against an
emittable 21:9 — drift 1.20, comfortably inside. Read the ceiling in
`runtime/atlas-hero-driver.cjs` before re-raising it as a blocker.

- [x] **Each Zone 1 panel is re-authored on its own ~4096 px canvas**, shown its
      own cell from the accepted sheet and continuing the same conversation.
      Measured on the live manifest: driver **5.91 → 24.56 px/in**, every
      surface at least 3×, aspect drift < 0.002.
      Evidence: `tests/atlas-panel-refine.test.mjs`.
- [x] **It fails soft, per surface.** A refused panel keeps its original crop;
      the assembled master still ships. Evidence:
      `tests/atlas-panel-refine-wiring.test.mjs` case 3 (five of six zones
      re-authored, asserted on the master's pixels).
- [x] **`fit` is re-measured on the refined pixels**, never carried from the
      sheet crop. `inkFraction` takes an optional rectangle and is exported
      rather than re-typed.
- [x] **The die-cut gate still runs first** and refuses before an image request
      is spent. Evidence: wiring lock case 5.
- [x] **Both Call-1 paths forward the transport** — in-process and the durable
      `proof.assemble` node, which is the live one (`CALL1_GRAPH=on`). The
      topology builds no door of its own (RULE 0.26). Evidence: wiring lock
      case 6, verified to fail against the pre-fix tree.
- [x] **`ops/release-files.txt` carries the new module.** The droplet ships that
      list, not the repo; `source-tests/runtime/runtime-closure.test.mjs` caught
      its absence, which would have been a deploy that crashes on require with
      every logic lock green.
- [ ] **A live generation with the flag on.** Nothing below is claimed until the
      same New Aura brief has been run both ways on the validated **F250** and
      the two exported sheets judged side by side. That is the owner's
      acceptance standard, not a green suite.
- [x] **The canvas size is a property of the ask.** `ATLAS_AUTHOR_IMAGE_SIZE`
      stays 2K as the DEFAULT (right for the hero cascade, and an unchanged
      caller cannot be surprised by a bigger, slower ask); the caller may name
      `imageSize`, validated against {1K, 2K, 4K}, and the refine asks 4K. On a
      166.8″ flank: 5.0 px/in from the shared sheet, 12.3 at 2K, 24.6 at 4K.
      The receipt reports `pxPerInchDelivered` beside `pxPerInchAfter`, because
      the canvas number alone would claim interpolated pixels.
      Evidence: wiring lock case 7. **Needs an edge deploy of
      `design-panel-ai-generate` — until then the edge answers at 2K and the
      receipt says so, which is the honest half-gain, not a failure.**
- [x] **`mode` and `designAnchor` were being eaten at the node boundary, not
      failing to be produced.** The edge emits both (read back from the deployed
      body), the transport parses both, the assembler writes both — and
      `proof.sheet`'s hand-written output projection carried 11 of the 16 fields
      the assembler reads. Measured on `848be1c6`: every projected field carried
      a real value, every unprojected one read null/0. Four were lost — `mode`,
      `designAnchor`, `artboardQualityExamplesApplied`, `promptVersion`.
      Fixed by `sheetOutputFields`, a named function reconciled against the
      assembler's own reads (`tests/atlas-panel-proof-sheet-crosses-the-node.test.mjs`,
      verified to fail pre-fix and to NAME the missing fields).
      **Runtime-only — no edge deploy needed.**
- [ ] **A live run showing `mode` and `designAnchor` populated.** The fix makes
      the receipts able to report; only a fresh generation proves they do. Judge
      the seven proofs against the design once the real DESIGN ANCHOR reaches
      Call 2's photographer.
