# A.T.L.A.S. v28 — the clean base and the element graph

**Deployed 2026-09-18 05:07 UTC. Not yet judged on pixels.** This is the state
to test from in the morning, what to look at, and what it means if it is wrong.

---

## What is live, and how each half was verified

Nothing below is taken from a green checkmark. Each line is read back off the
thing itself.

| half | value | how it was proven |
|---|---|---|
| **Database** | migration `20260918030000` applied | present in `supabase_migrations.schema_migrations`; the LIVE `finish_designpro_atlas_call1_node` body contains the `master.composite` branches and the `r.master_storage_path IS NULL` guard |
| **Edge** | `atlas-artboard-designiq.20260918.v28-clean-base-elements` | read out of the deployed function body; `ATLAS_CLEAN_BASE_CONTRACT` and `atlasCleanBase` both present |
| **Runtime** | `a02066f5`, both replicas | `designproai-runtime:a02066f5…` / `-gateway:` retagged, `Deployed web, gateway, and two exact-SHA DesignPro runtime replicas`, `VERIFIED_WORKING` |

Runtime and edge report the **same** prompt version, so the version fence is
closed and generations run.

**Resolved routing flags, straight off the deploy log:**

```
DESIGNPRO_ATLAS_TOPOLOGY=six-surface   DESIGNPRO_ATLAS_FIELD_FIRST=off
DESIGNPRO_ATLAS_HERO_FIRST=off         DESIGNPRO_ATLAS_ELEMENT_GRAPH=on
DESIGNPRO_ATLAS_CALL1_GRAPH=on         DESIGNPRO_ATLAS_PANEL_FINISH=off
```

`ELEMENT_GRAPH=on` was already set before this deploy and was **inert**, because
the element nodes compiled only inside the hero-driver cascade and hero-driver is
off. That flag is what changed meaning tonight.

> **The droplet runs `a02066f5`. `main` has since moved on** (`31d641b1` at time
> of writing). That is expected — the droplet is pinned to an exact SHA — but do
> not assume the head of main is what is deployed.

---

## What changed, in one paragraph each

### 1. The output-class gate reads panels, not a squeezed sheet

Live `efca5e03` (Oasis Pools, 2019 F250) shipped both flanks die-cut to a truck
silhouette — wheel arches, door seams, handles, mirror — on an `rgb(88,88,88)`
surround, and **every gate said yes.**

Every hole predicate in the stack is a *darkness* test (`holeAt` ≤ 24,
`nearBlackAt` ≤ 40). The surround measured luma 88 — 3.7× the near-black ceiling
— so `edgeHoleRatio` read 0.073 against a 0.35 limit, `nonBlackFraction` 0.939,
`opaqueRatio` 1.00000, and the cut-out fill had nothing to fill.

The inspector should have caught it, and **its prompt was already right**: it
describes *"a rectangle whose artwork is a vehicle-shaped island … a plain
single-colour surround (grey, white, black or any colour) fills the rest."* It
answered `flat_atlas` at **confidence 1.0** with *"no visible vehicle anatomy"* —
because it judged the whole 4096² master squeezed into one 1280px JPEG, leaving a
971×3712 driver flank ~303px across its short side and lying on its side. The
failure was perception, not wording.

It now transports each surface separately, cropped and rotated into reading
orientation with the same `extract → rotate → flatten` order `cutCallOnePanels`
uses, so it judges the panel the customer receives. Flank 303px → 419px upright;
hood ~370px → its native 987px. **Without `zones` the request is byte-for-byte the
previous one**, so any caller without a manifest keeps the old behaviour rather
than losing the gate.

This is the same defect RULE 0.36 fixed for the lettering reader (*"The read is of
the DRIVER PANEL, not the sheet"*) and the one RestylePro records for its proof
sheet. The lesson had never been carried here.

### 2. Six-surface reaches the element graph

Both halves of the element architecture already existed and were correct.
`ATLAS_CLEAN_BASE_CONTRACT` was deployed in the edge and correctly *replaces* the
brand block rather than standing a negative beside it; `cleanBaseEnabled()`
already coupled it to `DESIGNPRO_ATLAS_ELEMENT_GRAPH` so the ask and the
compositor can never be half-on; the five nodes were deterministic and made no
model calls.

They simply compiled **inside** `compileHeroDriverGraph`. Measured: live
`efca5e03` had **zero** graph runs and **zero** nodes, and across all history
there are **6 `master.composite` rows and ONE completed**. No customer has ever
received a clean base with a composited lockup. That is the entire reason the
company name and contact bar are painted by the diffusion model.

Now: `elementNodes()` is one builder for both shapes (hero passes
`masterNode=master.assemble`, six-surface passes null), `atlasEdgeRequestBody`
sends `cleanBase` off the same flag, and `authorElements()` runs the subgraph
against the already-accepted sheet.

---

## Test it in this order

1. **Generate one design.** F250 preferred — the 2022 Porsche 911 Turbo catalog
   row (`0c211a9d`) has never been operator-validated, so every 911 canary reports
   failure at the GENIE step regardless of the generation.

2. **Look at the flanks first.** The company name should be **crisp vector type**,
   not painted lettering. That is the whole point of the change. Zoom in: vector
   type has clean edges at any magnification; diffusion lettering softens and its
   strokes wobble.

3. **Then the front panel and the passenger flank** — the two that were worst on
   `efca5e03`. A die-cut truck on a grey surround should now be **refused and
   re-rolled**, not shipped.

4. **Only then read the receipts.** They are corroboration, never the verdict —
   `efca5e03` reported 7/7 accepted while shipping a picture of a truck, and
   `cc382c3c` reported `status: "verified"` over a reversed company name.

---

## Reading `metadata.elementGraph`

The three states are deliberately distinguishable. Conflating them is how a
silent regression reads as a clean run.

| value | means | what to do |
|---|---|---|
| `null` | never ran — flag off, brief had no name/contact/logo, or the worker lacked `authorElements` | if the brief had a company name, this is a defect: the graph should have run |
| `changed: true`, `applied: [...]` | **the good case** — elements composited onto the clean base | check the pixels match `applied` |
| `changed: false`, `refused: [...]` | it RAN and its sheet failed structural re-validation, so the clean base was kept | read `refused`; the sheet will have no lettering |

`cleanMasterHash` is Layer 0's hash — the base the lockup was composited onto. It
is provenance, and a later element edit re-composites onto it rather than healing
painted pixels.

**A run with `cleanBase` on and `elementGraph: null` ships a wrap with no company
name.** That is the one combination to treat as a bug rather than a variation.

---

## If it is wrong

**Rollback is one flag, and it needs no code change:**

```
deploy-production.yml → atlas_element_graph: off
```

That restores lettering-in-pixels authoring immediately — `cleanBaseEnabled()`
reads that flag, so Call 1 stops asking for a clean base and the composite stops
running, in one move.

**`atlas_call1_graph: off` also turns the ask off, and until 2026-09-18 it did
not.** The compositor is reached only through the Call-1 node worker, so that
kill switch — meant for the hero cascade, silent about lettering — silenced the
compositor while Call 1 kept asking for a sheet with no lettering: a wrap with no
company name, one flip of an unrelated switch away, while the code comment and
CLAUDE.md both said half-on was impossible. `cleanBaseEnabled` now returns false
when `DESIGNPRO_ATLAS_CALL1_GRAPH=off`. The ask follows the ability; the reverse
coupling is deliberately not done, because `authorElements` drives that worker's
own `tick()` and would hang against a disabled one. Production runs
`CALL1_GRAPH=on`, so no generation was affected.

The migration is safe to leave applied under any flag state: `master.composite`
only writes the run's master columns **while they are NULL**, and a runtime with
the element graph off never creates an element run at all.

Full rollback to v27 is redeploying the previous edge version **and** the previous
droplet SHA — both, or the version fence refuses every generation.

---

## Known limits — read before concluding anything

- **First live run.** `master.composite` has completed **once** in this system's
  history, in a test. Nothing about the element path has been judged on real
  pixels yet.
- **The plain-surround metric is evidence, not a verdict.** `measurePlainSurround`
  records the dominant plain border field per zone. On the real panels it
  separates cleanly — `efca5e03` driver 0.624 border share vs the Sept-8 good
  master's 0.064 — and it still may not convict, because this repo's own
  full-bleed fixtures (a flat ground with graphics inset from the edge) score
  **1.000**, *more* extreme than the defect, and are legitimate: a navy wrap
  prints navy to the edge. No border-share threshold separates "canvas showing
  through" from "a flat ground that is the design". RULE 0.32 refused this
  detector for exactly that reason. **Do not promote it to blocking without a new
  discriminator.**
- **The lockup is placed at a fixed anchor on the flanks** (`ELEMENT_SURFACES`).
  Hood, roof, front and rear carry no element today. If the owner wants branding
  on the centre surfaces, that is a change to `atlas-element-lockup.cjs`, not a
  defect.
- **Latency is unchanged by this work.** Measured on `efca5e03`: request → driver
  proof **4m 00s** (queue 6s, Call 1 82s, output-class 19s, passenger mirror 55s,
  master at 198s, seven concurrent proofs 42s). The SLO is 90s. The element graph
  adds deterministic work only — no model calls — but it has never been timed
  live.
- **"Driver first" does not give an early look.** All seven proofs are dispatched
  together and land within 1–8 seconds of each other; `side` is often *last*.
  `runAtlasProofStages` says so in its own comment (*"PRIORITY IS NOT
  PREREQUISITE"*), and the un-gating was deliberate — it fixed two real defects.
  But RULE 0.23's promise of a look ~1 minute before the set is not being kept.

---

## Correction owed to CLAUDE.md

**The `release.yml` concurrency hazard it describes is fixed and the entry is now
stale.** CLAUDE.md says dispatching on `main` cancels the merge's own push gate,
because both resolve to `designpro-release-refs/heads/main`. The workflow now keys
its concurrency group on the **event** as well, and says so in its own comment:

> *"This group used to be `designpro-release-<pr number or ref>` … It has cost a
> release twice, in opposite directions."*

The ordering advice that follows from it (migration before runtime) is still
correct, but for a different reason — see below.

## The deploy order, and why it is not optional

```
merge → push gate green → release.yml APPLY_DESIGNPRO_PRODUCTION → deploy + edge
```

**The migration must land before a v28 runtime.** A commit message in this change
claims `authorElements` fails soft when the database lacks the migration. **It does
not.** Without `20260918030000` the nodes run normally and the *last* one sets
`state='completed'` with `master_storage_path` still NULL, tripping

```sql
CHECK (state<>'completed' OR (... master_storage_path IS NOT NULL ...))
```

so the RPC raises and `authorElements` throws — *after* the work. With `cleanBase`
on there is no acceptable recovery: Layer 0 has no company name, so shipping it
delivers an unbranded wrap and failing kills an accepted design.

The three `null` returns that **are** genuinely soft: the flag is off, the brief
has nothing to place, or `authorElements` is absent from the injected worker.

The merge commit for #494 deliberately carries **no** `[dark-deploy]` marker so
auto-deploy could not race the migration.

---

## Receipts for this deploy

| | |
|---|---|
| PR | #494, merged as `135ea354` |
| chain reconciled by | `a02066f5` (#496) — #495 added a migration between the PR gate and the merge, so both chain assertions were briefly stale and `135ea354`'s push gate failed on `npm test`. Not a code defect; the tripwire working. |
| migration run | `35308455102` — `production-migrate` success |
| edge run | `35309098015` — every step ran, including "Verify deployed functions" |
| droplet run | `35309184969` — `VERIFIED_WORKING` |
| suite at merge | 409 / 1290 / 85 / 8 / 66, zero failures |
