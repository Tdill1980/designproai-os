# ARCHITECTURE_DAG.md — the A.T.L.A.S. Call-1 node graph, with element-level nodes

**Owner directives, 2026-09-17, verbatim:**
*"port the element-level graph into designproai-os right now. Make the logo,
typography, and contact bar first-class, deterministic nodes in the DAG."*
*"The RestylePro model (Layer 0 clean base, Layer 1 composited elements) is
exactly how we are building this. The Call-1 contract must change to generate a
logo-free canvas."*
*"we are going to future-proof this build against context loss … This is our
persistent state anchor."*

**This file is the persistent state anchor.** A session that has lost its
context reads THIS plus `CLAUDE.md` and knows the contract without re-deriving
it. It is authoritative for the Call-1 graph SHAPE — node topology, inputs,
outputs, edges. The RULE 0.x policy in `CLAUDE.md` still governs policy.

Status key: **LIVE** = deployed · **BUILDING** = this port · **OWNER-RULED** =
decided by the owner, not by a session; do not re-open it.

---

## 1. What Call 1 is today (LIVE, hero-first enabled)

`runtime/atlas-call1-graph.cjs`, `compileHeroDriverGraph({heroFirst})`:

```
surface.driver.view ──▶ surface.driver ──▶ surface.passenger ──▶ ┌ surface.hood  ┐
                                                                  │ surface.front │──▶ surface.roof ──▶ master.assemble
                                                                  └ surface.rear  ┘
```

| node | depends_on | what it does |
|---|---|---|
| `surface.driver.view` | — | NODE 1. One 16:9 vehicle render, from scratch, `first: true`, no history (a conversation here would be a second creative authority — RULE 0.26) |
| `surface.driver` | `surface.driver.view` | NODE 3. Flattens that render into the driver flank. Receives `heroViewStoragePath` + `heroViewContentHash` and **replays node 1's exchange with its `thoughtSignature`** (`v3-flatten-continues-the-view`) |
| `surface.passenger` | `surface.driver` | code only, zero model calls: `flop(driver)` + lettering re-drop. Declines on the field topology (`field_passenger_is_its_own_territory`) |
| `surface.hood/front/rear` | `surface.passenger` | parallel; each replays the driver exchange, SHOWN driver + passenger |
| `surface.roof` | hood, front, rear | shown all five; replays driver, hood, front, rear |
| `master.assemble` | all surfaces | places the six rectangles in the GENIE manifest zones; whole-master gates judge the sheet |

**Invariants this port does not touch:**

- node-to-node handoff is an **immutable reference** — `{storagePath,
  contentHash, byteSize}` — never a blob or unpersisted buffer (RULE 0.39).
- the graph SHAPE is compiled once at run creation and **stored as node rows**;
  a flag flipped mid-run cannot change what a claimed node does.
- `wrap-files` is **private**: storage path + sha256, never a URL (RULE 0.5).
- `SURFACE_KEYS` stays exactly six; `source.verify`'s exactly-six-distinct and
  exactly-two counts are frozen.
- nothing after Call 1 changes — Call 8, Call 9, QC, Topaz, ZIP, WrapBox.

---

## 2. Why this is the root defect (measured)

**There is no element-level design anywhere in the graph.** Verified by grep,
2026-09-17: zero nodes keyed on logo / text / element. Lettering and logo are
authored INSIDE each surface's one image call, as prompt text
(`buildLogoArchitecture()` / `LOGO_REQUIREMENT`, `runtime/designiq-prompt.cjs:369`).

Everything element-shaped today is **downstream and corrective**, reading a
finished raster: Call 10 `logos.extract` (registers what was painted), Call 11
de-logo (erases from QC duplicates only), `runtime/atlas-lettering-read.cjs`
(reads bands off the flank and re-drops them forward).

Reconstructing element identity from pixels after the fact is why the passenger
flank broke four distinct ways since 2026-09-07 — `8eec8162` reversed PORSCHE,
`9789762d` pasted seven raw stripe patches over mirrored artwork, `cc382c3c`
certified a flank the reader could not see, `8c525565` shipped a doubled
reversed lockup onto a 150-PPI print panel. **Four defects, four fixes to the
READER, and the reader was never the cause.** An element that is a known object
with known geometry needs no reader at all.

---

## 3. The reference implementation (RULE 1 — named before any code)

| role | file | what it proves |
|---|---|---|
| **producer** | `restylepro-os api/typeset-layer.js` (176 lines) | `opentype.js` parses a TTF → each string becomes SVG `<path>` **outlines** → sharp rasterises pure geometry. `renderLockup()`: name at 12% of width, contact lines at 5%, centred by advance width, canvas height from the real descender. 20 curated static Google TTFs, fallback to Anton. Returns `engine: "real-typography", deterministic: true` |
| **why outlines, not `<text>`** | that file's header | serverless sharp/librsvg ships **no system fonts** and ignores data-URI `@font-face` — SVG `<text>` renders as empty tofu boxes. A hard constraint, not a style choice |
| **element taxonomy** | `restylepro-os supabase/functions/extract-logo-elements/index.ts` | `type: 'logo' \| 'text' \| 'phone' \| 'url' \| 'graphic'` |
| **placement contract** | `restylepro-os src/lib/buildProductionPanels.ts:606-635`, `flatMasterSheet.ts:97` | normalized `{xPct, yPct, wPct, hPct}`; `logo_pack: [{url, label, widthPct, heightPct}]` |
| **layer model** | restylepro-os `CLAUDE.md`, LAYERED LOGO EDIT + LOGO PACK | Layer 0 = the **authored** clean artboard; Layer 1 = the real element composited on top. *"The clean base is AUTHORED, not stripped"* — never heal/strip, which smears |

**Honest limit of the reference (RULE 1 requires stating it):**
`api/typeset-layer.js` carries its own header line — *"ISOLATED + ADDITIVE:
nothing in the live pipeline calls this yet."* RestylePro proves the
**producer**. It does **not** prove the integration. This port is proven logic
into unproven wiring; do not describe it as restoring something that ran in
production over there.

---

## 4. The new DAG (BUILDING)

Element producers are **roots** — they depend only on the run's frozen input, so
they are claimable in the same instant as `surface.driver.view` and add **zero
latency** to the critical path.

```
typeset.produce ─┐
contact.produce ─┼─▶ element.lockup ──────────────────────────┐
logo.prepare    ─┘                                             │
                                                               ▼
surface.driver.view ─▶ surface.driver ─▶ surface.passenger ─▶ {hood, front, rear} ─▶ surface.roof ─▶ master.assemble ─▶ master.composite
     (CLEAN BASE — no lettering, no logo, no company name, on every surface)                                                   │
                                                                                                                    Layer 0 + Layer 1 = the sheet
```

### 4.1 `surface.*` now author a CLEAN BASE (OWNER-RULED — Call-1 contract change)

Every surface, including node 1's vehicle render, is authored **logo-free and
lettering-free**: artwork, colour, composition and motion only. No company name,
no phone, no URL, no logo mark, no brand lockup. That canvas is **Layer 0**.

This is a deliberate change to the Call-1 creative contract, made by the owner
on 2026-09-17, and it is the one change in this port that is not additive. It
supersedes, for the element half only, the prompt-side logo direction in
`buildLogoArchitecture()` / `LOGO_REQUIREMENT`. RULE 0.37's side-by-side
requirement still applies to the FIELD TAIL wording and is not waived by this
entry — the clean-base instruction is judged on a real run against the
2026-09-04 Arctic Air and 2026-09-08 Precision sheets before it becomes default.

### 4.2 `typeset.produce`

| | |
|---|---|
| **depends_on** | ∅ |
| **input** | `{ role: "typography", text: <company name>, fontKey, colorHex, widthPx }` — from the run's frozen input, never from a model |
| **output** | `{ contract, role, storagePath: "atlas-elements/<sha256>.png", contentHash, byteSize, box: {wPct, hPct}, metrics: {advanceWidth, ascender, descender, unitsPerEm}, font: {key, sha256}, deterministic: true }` |
| **producer** | `runtime/atlas-typeset-layer.cjs` (the port of `api/typeset-layer.js`) |
| **AI calls** | **zero** |
| **idempotent** | yes — the path IS the sha256 of the bytes, so a re-claimed node re-reads rather than re-writes |

### 4.3 `contact.produce`

Same producer and envelope, its own node and its own root, `role: "contact"`,
set in the contact face rather than the display face.

`contactLinesFrom()` reads **`phone` and `website` and nothing else** — those are
the only contact fields the input contract carries
(`designpro.calls-1-7-input.v3`), so a city line is never conjured to balance the
bar. **A line the customer did not supply cannot exist**: the node sets the exact
strings its row carries, and there is no path from the brief to the canvas that
does not go through that input. This replaces the prompt sentence asking the
model not to invent a phone number or a web address — a sentence that has needed
fixing before, at the phone-missing / website-supplied hole, which is now a
test case.

A brief with contact details but no company name still gets its bar; a brief with
a name and no contact details still gets its lockup.

### 4.4 `logo.prepare`

| | |
|---|---|
| **depends_on** | ∅ |
| **input** | the customer's uploaded logo reference, if any |
| **output** | same envelope, `role: "logo"`, `source: "customer"` — or `{ role: "logo", source: "absent" }` |
| **producer** | `runtime/atlas-logo-prepare.cjs`. **It never GENERATES a logo.** With no upload there is no node, and the typography lockup is the brand mark — which is what `buildLogoArchitecture()` already directs on the prompt side |

The verification is `verifiedCustomerLogoPart`'s (`runtime/flat-first-atlas.cjs`),
re-homed unchanged so a graph node can run it without dragging in that module:
a URL in the asset is refused outright, the identity must be
storagePath + 64-hex hash + positive integer byteSize, and the downloaded bytes
must be exactly that length and hash to that value. Conditioning is the same
too — EXIF rotate, fit inside 1600×1600 **without enlarging**, lanczos3, PNG.
`tests/atlas-logo-prepare.test.mjs` reads flat-first-atlas's own source and
fails if either the codes or the conditioning parameters drift apart.

**The identity is verified at COMPILE time**, so a malformed asset refuses the
run before any worker spends a lease.

**Transparency is recorded, never manufactured.** A customer JPEG has no alpha,
and keying a white background out with a flood fill is the same fragile move
CLAUDE.md records failing on same-hue artwork (at tolerance 28 it ate an orange
mark touching an orange ribbon). The node reports `hasAlpha` honestly and leaves
the decision to `master.composite` and human QC.

### 4.5 `element.lockup`

| | |
|---|---|
| **depends_on** | exactly the element nodes that EXIST — no phantom edge to a node a brief never produced |
| **producer** | `runtime/atlas-element-lockup.cjs` |
| **output** | one placement manifest: each element reference plus its normalized `{xPct, yPct, wPct, hPct}` box per surface, in the RestylePro vocabulary |
| **AI calls** | zero, and it stores nothing — dimensions in, a plan out |

**The coordinate space is the surface's own TRIM rectangle, in the panel's
READING orientation** — not the 4096 sheet, and not the zone including bleed.
Stating that precisely is not pedantry: a flank sits rotated 90° on the sheet,
and "which space is this box in" is exactly the ambiguity that produced four
separate passenger defects when placement was reconstructed from pixels.

Geometry, derived and locked:

- **aspect is preserved.** The axes are normalized against different pixel
  dimensions, so holding an element's shape means
  `hPct = wPct × (elemH/elemW) × (trimW/trimH)`. Getting it wrong stretches the
  customer's logo, which nobody notices until it is on vinyl.
- **the passenger box is the driver box MIRRORED** (`xPct' = 1 − xPct − wPct`,
  RULE 0.36's own mapping) **and the element is composited un-flipped**
  (`flipped: false`, asserted). Same physical place on the vehicle, still reading
  left to right.
- **nothing leaves the safe area**, and an over-tall stack is scaled as a GROUP
  so the arrangement survives instead of one element shrinking out of proportion.

Taste, defaulted — one named constant each, all the owner's to change:
`ELEMENT_SURFACES` (the two flanks, which is where both evidence sheets put the
company name), `LOCKUP_WIDTH_PCT` 0.34, `SAFE_MARGIN_PCT` 0.08, `STACK_GAP_PCT`
0.03, `STACK_ORDER` logo → typography → contact, left-anchored, vertically
centred. **Hood, roof, front and rear carry no element** until the owner rules
on each: inventing a rear contact bar is a design decision, not a geometric one.

**OWNER RULING, 2026-09-17:** an uploaded logo does **not** suppress the typed
company name. Commercial wraps routinely carry a brand mark and a wordmark, so
both nodes compile when both exist in the brief.

### 4.6 `master.composite`

| | |
|---|---|
| **depends_on** | `master.assemble`, `element.lockup` |
| **input** | Layer 0 (the assembled clean sheet, by reference) + Layer 1 (the element manifest, by reference) |
| **output** | the composited master: `{storagePath, contentHash, byteSize, layers: [...]}`; **Layer 0 is preserved byte-for-byte** as `cleanMasterHash` — the same duplicate-never-mutate rule Call 11 already follows |
| **AI calls** | zero — sharp composite at the manifest's boxes |
| **gates** | the composited sheet is what the whole-master gates judge, and what the six panels are cut from |

**Passenger consequence, which is the point of the whole port:** with lettering
as a known object, the passenger flank is `flop(cleanDriver)` + the SAME element
composited un-flipped at the mirrored box. There is no band to read back and
nothing to paste over. `atlas-lettering-read.cjs` stays for the contracts that
still mirror painted lettering; it is not deleted.

---

## 5. Deltas from the reference (the standalone boundary)

| reference | here | reason |
|---|---|---|
| `getPublicUrl(...)` | `storagePath` + sha256 | `wrap-files` is private; RULE 0.5 freezes the seam as content-addressed, never a URL |
| `text-layer/typeset/<Date.now()>-<random>.png` | `atlas-elements/<sha256>.png` | not idempotent under the lease/retry model; a re-claimed node must re-read, not re-write |
| Vercel serverless handler | runtime `.cjs` module | Call 1 runs on the droplet runtime; no HTTP endpoint is added |
| fetches TTFs from `raw.githubusercontent.com` **at request time** | fonts **vendored into the repo + runtime image**, hash-pinned | a graph node that can fail on a third-party fetch is not deterministic |
| `opentype.js` in `app/package.json` | added to `runtime/package.json` | the node runs in the runtime image, which does not have it today |

---

## 6. Chunked execution order (context-loss safe)

One chunk at a time. Each lands with its own lock, verified to fail against its
own absence before it is called done.

| # | chunk | status |
|---|---|---|
| 1 | vendor the TTFs + `opentype.js` in `runtime/package.json` + font hash pin | **done** (`be8d583c`) |
| 2 | `runtime/atlas-typeset-layer.cjs` + byte-determinism test | **done** (`8768b2f2`) |
| 3 | `typeset.produce` node: compiled into the graph, claim, envelope, idempotent re-claim | **done** (`a5faf833`, release policy `54ad1039`) |
| 4 | `contact.produce` node + the never-invent input assertion | **done** |
| 5 | `logo.prepare` node (pass-through, honest `absent`) | **done** |
| 6 | `element.lockup` placement manifest | **done** |
| 7 | clean-base authoring contract (§4.1) — prompt versions advance together | pending |
| 8 | `master.composite` + clean master preserved byte-for-byte | pending |

**A CHUNK IS NOT DONE UNTIL THE FULL SUITE IS GREEN, not when its own lock
passes.** Chunks 1 and 2 passed their own tests and were NOT releasable: the
release policy (`ops/release-files.txt`) enumerates every runtime file
individually, so `atlas-typeset-layer.cjs` and its 42 font files would not have
shipped in the archive — and because that module reads `fonts.json` at REQUIRE
time while the policy's walk follows `require()` calls and not data reads, the
faces were invisible to every check. It would have surfaced as a health probe
timing out after the cutover, with no module name and no stack. Only
`npm test` caught it. A new runtime file means: `ops/release-files.txt`, the
count tripwire in `ops/tests/ops-hardening.test.mjs`, and — for a new directory —
`allowed_directory()` in `ops/validate-archive.py`.

**Rule for every chunk:** no chunk may change a gate threshold, `SURFACE_KEYS`,
a storage contract, or anything after Call 1. With
`DESIGNPRO_ATLAS_ELEMENT_GRAPH=off` the compiled graph must be byte-for-byte
today's graph — the kill-switch-by-shape rule from RULE 0.39 — and that flag
must be threaded through `configure-env.sh`, `validate-env.py`, the
resolved-flag banner and `ops/tests/deploy-workflow.test.mjs` **in the same
commit that adds it**, or it is not a switch (CLAUDE.md, "A FLAG THE RUNTIME
READS AND THE WRITER DOES NOT WRITE IS NOT A SWITCH").
