# CODEX HANDOFF — designproai-os

**Written 2026-08-20. Read this before changing anything.**

Your job in this repository is **architecture conformance, not redesign.** The
product architecture below is frozen by the owner. Where the code disagrees
with it, the code is wrong. Do not resolve a disagreement by changing the
architecture, by consolidating surfaces, by "simplifying" a stage, or by
concluding that a component is obsolete. If you believe a frozen decision must
change, stop and say so — that is an owner decision, not an implementation one.

The most expensive failures in this repository have all been the same shape: a
session inferred that something was retired, optional, or superseded, and acted
on the inference. Nothing failed loudly. The product simply lost a capability
and everything downstream looked fine.

---

## 1. Current state

| | |
|---|---|
| Repository | `Tdill1980/designproai-os` |
| Handoff branch | `codex-handoff` |
| `main` HEAD | `942fbdd7b1c91a210142d78da54c728ba933e2d1` |
| Deployed to production | `942fbdd7b1c91a210142d78da54c728ba933e2d1` |
| Production host | `os.designproai.com` (droplet `designproai-prod-sfo3`, 137.184.0.4) |
| Supabase project | `wozyamlnygaddievzuwn` |
| Working tree | clean |

`main` and production are the same commit. Nothing is pending deployment.

**Rollback** is one operation on the droplet:
`ops/rollback.sh <sha> ROLLBACK_DESIGNPRO_ONLY`. The previous release is
`812c5ba4b2d71b0dabb3dac917875fa3e2eb0cee`.

### Open pull requests

Five, all stale, all predating the current work (2026-08-09 → 2026-08-16):
**#59, #40, #34, #30, #10**. None are mine and none are required. Treat each as
unreviewed history rather than pending work; #40 in particular describes a
migration that has since happened by another route.

### Unmerged commits that matter

None. Every change from this session is merged into `main` and deployed.

### Deploy path

Deployment is gated and manual. The release gate (`release.yml`) must run and
succeed **on `main`, via `push`**, before `deploy-production.yml` will accept
the SHA. Dispatch the deploy with `exact_sha` plus
`DEPLOY_DARK_TO_DESIGNPROAI_PROD_SFO3`. The auto-trigger additionally requires
the literal string `[dark-deploy]` in the merge commit message; without it the
auto path correctly refuses.

Migrations are **not** applied on merge. They require a separate protected
dispatch of `release.yml` with `production_migration=APPLY_DESIGNPRO_PRODUCTION`.

---

## 2. Frozen product architecture

One DesignID owns Calls 1–8. After Call 8 the design is **frozen** and every
later stage is deterministic manufacturing of that exact design. There is no
second design generation after approval, no independent manufacturing artwork,
and no reinterpreting the brief downstream.

| Call | Produces |
|---|---|
| 1–7 | The design and all locked-angle customer views, under one identity. Seven views. The passenger side is **generated, never mirrored** in this system. |
| 8 | The 2D Production Proof for that same DesignID/revision, at GENIE dimensions with 5" bleed, plus the canonical production surface per side. |
| 9 | The six extracted **branded** production panels at GENIE geometry + 5" bleed, with independent immutable hashes. This is the original production artwork and it is **never mutated again**. |
| 10 | Logo asset registration / separation for the accepted design. |
| 11 | **Duplicates** the six branded panels, removes logos from the **duplicates only**, emits six `qc-panel` artifacts bound to their source panel hash and surface_key, and pushes them to PanelPro for human sizing/template QC. |

**Hard order:** Design → Extract → Separate/register logos → Duplicate +
de-logo → PanelPro QC → Topaz → Final outputs → ZIP → WrapBox.

Topaz runs **after** PanelPro preflight and only on the authoritative branded
path, never on QC derivatives. The runtime's frozen `STAGES` list already
orders `await_panelpro_preflight_qc` before `enhance.upscale`. Do not reorder.

### The generation ↔ manufacturing seam is frozen

Frozen by real name: `SURFACE_KEYS` / `surface_key`; content-addressed
`storagePath` in the private `wrap-files` bucket (never a URL); sha256
`contentHash`; `revisionId` embedded in the path; receipt kind + `receipt_hash`;
and `source.verify`'s exactly-two-proofs / exactly-six-distinct-panels check,
which is what makes implicit mirroring impossible.

Geometry is **not** on this seam. Dimensions resolve from the vehicle at
`manifest.resolve` via the GENIE manifest. Generation must not emit dimensions.

### There is no pre-branding base artwork

Calls 1–8 emit a single composited raster per surface. Call 9 consumes those
exact bytes. The revision snapshot carries no base-artwork field. Do not erase,
inpaint, regenerate, pixel-lift, approximate a clean background, or reclassify
baked-in artwork as an overlay after the fact. Call 11's `qc-panel` duplicates
are **not** that base — they are non-authoritative, never printed, and never
Topaz/output/ZIP inputs.

---

## 3. Surfaces that may NOT be retired or consolidated

Each of these has been mistaken for optional at least once.

**RevisionStudio.** A required stage of the production flow, not optional UI.
It was described as "retired" in a commit message during this session. That was
wrong and was never authorized. See §5.

**PanelPro / Production Layers.** The customer-facing surface after Calls 8–11.
Consumer only — it displays what the runtime produced and starts nothing.

**GENIE.** Three jobs, none removable: it resolves the per-side dimensions
stamped on the 2D proof and on every panel (so proof dims == panel dims by
construction); it issues the order number / job id at Production Pack time; and
it drives the customer-facing progress UI.

**The Logo Pack.** A paid deliverable and a pre-order entice surface, produced
by Call 10's separation.

**The six canonical surfaces.** `driver, passenger, hood, roof, front, rear`.
Exactly six, always, each with its own bytes. The exactly-six invariant may
never be relaxed to make room for anything.

**WrapBox delivery, the QC stamp, and the ZIP.** The terminal path. A pack is
not delivered until the human QC checklist passes and the stamp is applied.

---

## 4. State of the DesignPro UI migration

**Correct the record first: no UI was migrated in this session.** The
DesignPanelProPremium application was copied into this repository on 2026-08-14
by commit `eec557d6` ("Copy the proven RestylePro shell in as the DesignProAI
app frontend"). What this session did was three things:

1. **Routes** — `/designpro/create`, `/designpro/premium`, `/designpanelpro`
   now render `DesignPanelProPremium` (#99).
2. **Transport** — `useDesignPanelProLogic` was rewritten so Calls 1–7 run on
   the standalone runtime instead of the browser. Nine browser-side
   `supabase.functions.invoke` calls became zero (#99).
3. **Navigation** — every Design entry point was repointed from the operator
   form to the restored UI (#104). Before that fix the restored UI was
   reachable only by typing the URL, which is not product acceptance.

### Verified present on the deployed build

Read out of the served JavaScript at `os.designproai.com`, not from source:
MyVehiclePro, vehicle type buttons, year/make/model, Artistic & Style /
Restyle, Business & Fleet / Commercial, Brand Direction, company name,
phone/website, logo control, Finish, DesignIQ, VisionBoardIQ, LayerLiftIQ.

The Design navigation button resolves to `/designpro/create`
(`{label:"Design",route:"/designpro/create"` in the live bundle).

### The customer path is closed against the RestylePro backend

`tests/designpro-customer-path-seam.test.mjs` walks every import from the
routes a signed-in customer can open and fails if any module in that closure
names a RestylePro production edge function, an Entice symbol, or a legacy
design table (`production_flow_assets`, `designiq_generations`,
`color_visualizations`). It found 90 violations across 13 files and they are
closed. **Those edge functions are still deployed and reachable on this
Supabase project** — the gate is what keeps the customer path away from them.

The gate also asserts that every DesignPro URL renders a module inside the
walked closure, and that no navigation surface links to the operator form.

---

## 5. RevisionStudio responsibilities

**RevisionStudio was never retired and was never authorized for retirement.**
A previous session's commit message described `RevisionStudioIQ` as "a
genuinely retired page". That was a false inference about a required pipeline
stage. No code ever encoded the claim; it existed only in prose. Do not
reintroduce it.

The operating invariant names it explicitly:

> design approved → automatic 2D Production Proof → six correct production
> sides → **RevisionStudio paired 3D render + 2D production panel per side** →
> Production Layers → production pack / output path

### Required responsibilities

- the 2D Production Proof (the customer-facing approval document)
- the approved 3D view **paired with** that same side's production panel, per side
- Production Layers — the six branded panels, the de-logoed QC set, the logo assets
- the revision path
- the Production Pack / Logo Pack purchase route

### Where they live today

Inside `/designpro/jobs/:generationId`
(`app/src/pages/designpro/ProductionWorkflow.tsx`). `/revision-studio`
redirects there — that redirect predates this session (`2d61e5e6`).

**The URL and component organisation are secondary. The responsibilities are
not.** It is acceptable for RevisionStudio to be implemented inside the job
page. It is not acceptable to decide the function is obsolete, to drop any
responsibility above, or to build a second competing implementation.

`app/src/pages/RevisionStudioIQ.tsx` still exists and is unrouted. It is the
RestylePro implementation and is wired to the RestylePro production backend.
Treat it as reference, not as dead weight to delete.

---

## 6. Call 8 and Call 9 invariants

### Call 8

Emits **several** artifacts of kind `flat-proof`:

- six **canonical production surfaces**, one per side, each carrying a `surfaceKey` and `metadata.role = "canonical-production-surface"`
- one **customer 2D Production Proof**, no `surfaceKey`, `metadata.role = "customer-2d-production-proof"`
- a **flat wrap layout** on `surfaceKey = "flat-wrap-layout"`

**The customer proof is selected by role and by nothing else.**

```ts
kind === "flat-proof" && metadata.role === "customer-2d-production-proof"
```

Never by `!surfaceKey`, never by array order, never by kind alone, never by
first match. Every one of these artifacts is a real, correct image of the right
design, so the wrong pick produces no error and nothing visibly out of place —
the customer simply approves a document that is not the one Call 9 cuts from.

The single authority is `selectCustomerProof` in
`app/src/lib/designpro-artifact-selectors.ts`. It returns `null` rather than
substituting and **throws** when a run carries two customer proofs, because
that is a contradiction in Call 8's output and not a preference. Both consumers
are locked by test.

The proof itself must be the vehicle-shaped shop drawing: six vehicle
elevations, the approved artwork, GENIE dimensions, +5" bleed, total square
footage, and the approval/signature presentation.

### Call 9

Per side, all of these must hold:

```
Call9 contentHash   == the Call 7 / canonical manufacturing-master contentHash
Call9 bytes         == those master bytes
surfaceKey            exact — no index, no order, no prefix, no alias
proofContentHash    == the customer Call 8 proof hash
revisionId            matches the run's revision
GENIE dimensions      match the proof's stamped dimensions
```

Six panels, six **distinct** content hashes. Two sides sharing a hash is a
driver→passenger substitution, which is the defect this product has shipped
most often.

Forbidden as a panel source: an AI-generated panel, a crop of the proof raster,
any redraw, and any cross-side reuse. Passenger mirroring is an explicit
operator action, never a pipeline default.

---

## 7. Known defects

### BLOCKER — Calls 1–7 send the model text only, and drop most of the input

This is the largest open defect and it is why generated designs are generic.

`runtime/generation-worker.cjs` builds the model request as `[{ text: design }]`.
`logoAsset` appears nowhere in that file — only in Calls 10/11. The provider's
only image handling reads images *out of* the response.

Consequences:

- **The customer's uploaded logo never reaches A.C.E.** It is verified, hashed
  and stored, then never shown to the model. A.C.E. invents a logo. This is the
  "invented logo / AI slop" failure and it is structural, not prompt tuning.
- **VisionBoardIQ reference images never reach it.** The prompt says "the
  provided reference images" while none are provided.
- **The company name never reaches it.** The worker reads `input.businessName`;
  the client sends `companyName`.

Separately, the `designpro.calls-1-7-input.v2` contract accepts exactly
thirteen keys and *refuses* the rest, so these have no field at all:
`finish`, `mascot`, `bulletPoints`, `styleDescriptors`, `visionBoardImages`,
`visionboardIntent`, `fontStyle`, `qrEnabled`.

The worker and the A.C.E. prompt **already consume every one of these**
(`runtime/designiq-prompt.cjs` reads `finish` ×5, `mascot` ×3, `visionBoard`
×2, `bulletPoints` ×2, `industryType`, `companyName`). The contract is the only
thing throwing them away.

Fixing this requires (A) widening the v2 contract and mapping the client to the
exact names the worker reads, and (B) attaching the verified logo and
VisionBoard references to the model request as inline image parts. **A without
B still invents the logo.** Both touch Calls 1–7 only.

**No work has started on this.** It was diagnosed and reported, not fixed.

### Auth surface — three open, one fixed

| | status |
|---|---|
| `trish@weprintwraps.com` had no `auth.identities` row, so it could never accept a password | **fixed** |
| Site URL pointed at `localhost:3000`, so every auth email dead-ended | **fixed** — now `https://os.designproai.com`, allow list is the production origin only |
| Login collapses "email not confirmed" into `invalid_credentials` | open |
| `send-password-reset` was never deployed to this project — no self-service recovery | open |
| The login page carries WePrintWraps Connect Portal branding and "your WPW password doesn't carry over" copy | open |

### Reported, not acted on

- The QC judge has been observed rejecting a panel for text that matches its
  source exactly.
- Five `GOOGLE_AI_API_KEY*` slots exist against three keys.

---

## 8. IMPLEMENTED vs DEPLOYED vs PRODUCT-PROVEN

Use these words precisely. IMPLEMENTED = the code exists. TEST-PROVEN = an
isolated test passes. DEPLOYED = that exact SHA is running. PRODUCT-PROVEN =
the real customer UI produced the real artifact on the live system.

| | state |
|---|---|
| Design-first Calls 1–7 contract (DB, gateway, client) | DEPLOYED |
| Calls 1–7 running server-side, zero browser orchestration | DEPLOYED |
| Customer path closed against the RestylePro backend | DEPLOYED, TEST-PROVEN |
| Call 8 proof selected by role, both consumers | DEPLOYED, TEST-PROVEN |
| Restored DesignPro UI reachable from the Design button | DEPLOYED |
| Call 11 `qc-panel` de-logo duplicates | IMPLEMENTED — not product-proven |
| Call 8 producing a correct 2D Production Proof | **NOT PRODUCT-PROVEN** |
| Call 9 producing six correct branded panels | **NOT PRODUCT-PROVEN** |
| Calls 10–11, Topaz, PanelPro QC, ZIP, WrapBox | **NOT PRODUCT-PROVEN** |
| Logo and VisionBoard reaching A.C.E. | **NOT IMPLEMENTED** — see §7 |

**Nothing in Calls 8–12 is PRODUCT-PROVEN.** No canary has been run through the
restored customer UI. The acceptance target is one real design — Flamingo Pools
— traversing:

```
Design button → real DesignPro UI → generate → seven views
  → RevisionStudio/job → authoritative Call 8 2D Production Proof
  → six Call 9 panels
```

Do not call the product ready before that traversal succeeds. Do not report
status from a status flag, a workflow conclusion, or a vault row — report it
from the artifact, its hash, and its metadata role.

---

## 9. Files under active repair

Nothing is mid-edit; the tree is clean. These are the files the open blocker
in §7 will touch:

| file | why |
|---|---|
| `supabase/migrations/*_designpro_calls_1_7_design_first_v2.sql` | the v2 input contract, currently thirteen keys |
| `gateway/src/server.mjs` | `CALLS_1_7_V2_KEYS` allowlist |
| `app/src/hooks/useDesignPanelProLogic.ts` | maps DesignIQ params onto contract fields |
| `app/src/lib/designpanelpro-standalone-adapter.ts` | the transport seam |
| `runtime/generation-worker.cjs` | builds the model request; must attach image parts |
| `runtime/generation-provider.cjs` | currently only reads images out of responses |

**Do not touch** `proof.build` / Call 8 composition or `panels.build` / Call 9
runtime while fixing the above. They are frozen pending the canary.

---

## 10. Rules for whoever works here next

1. **Conformance only.** No redesign, no consolidation, no retiring a surface.
2. **Never infer that something is retired.** If a component looks unused,
   assume it is required and find out why it is unreferenced. That inference
   has been wrong every time it has been made here.
3. **Report from artifacts, not flags.** A green workflow, an "applied"
   migration row and a `qc_pass: true` vault flag have each been false in this
   repository while the underlying thing was missing or wrong.
4. **A route nothing links to is not a restored product.** Verify reachability
   by navigation, not by URL.
5. **Fix a rule everywhere it applies.** The Call 8 role selector was fixed in
   one consumer and left broken in the one that mattered.
6. **The seam gate is the contract**, not a suggestion:
   `tests/designpro-customer-path-seam.test.mjs`. If it fails, the customer
   path can reach the old production backend.
7. Run the full gate — `npm test` — before proposing anything. It runs runtime
   and schema contracts, repository static contracts, the gateway suite, both
   frontends' tests and both production builds.

### Reference documents

`docs/BEHAVIORAL-SPEC.md` (required behaviour and acceptance criteria),
`docs/SEAM-FREEZE.md` (the frozen cross-session seam),
`docs/LAST-WORKING-STATE-2026-07-24.md` (what the working system produced),
`docs/RESTYLEPRO-REFERENCE-RULE.md` (per-stage reference map), and `CLAUDE.md`
at the repository root, which is authoritative over all of them.
