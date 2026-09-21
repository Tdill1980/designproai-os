# 🔒 VEHICLEPRO — OWNER'S SPEC, DICTATED 2026-09-21

**This is how OS.DesignProAI MUST work.** Dictated by Trish. It is the
DEFINITION OF "WORKING" for the VehiclePro product on `os.designproai.com`.

**If any other doc in `docs/` conflicts with this file, THIS WINS.** Do not
re-derive it, do not "improve" it, do not substitute a reading of the code for
it. The owner has given this spec repeatedly across sessions; it is written
here so it is never asked for again.

**What this file is NOT:** it is not a claim that any of it is built. It is the
target. Every section below is a SPEC line, not a status line. Verify against
the running system before reporting anything as done — see
`CLAUDE.md` → verification table.

---

## The flow, end to end

### CALL 1 — PRODUCTION PANEL PROOF (3 ZONES)

- The **first call** produces the **Production Panel Proof**, laid out in
  **3 zones**. Reference artifact: Ridgeline Custom Pools / 2024 Ford F-250 Crew
  Cab, "2D PRODUCTION PROOF" sheet.
- It must run through a **studio edge-function template**, wired so **Gemini 3
  sees it at the system level** (system-instruction wiring, not a user-turn
  prompt).
- **The moment Call 1 is generated it is SHOWN TO THE CUSTOMER.** No waiting on
  Call 2, no hidden intermediate state. Call 1 is a customer-visible artifact.
- Call 1 is the **source of truth for every panel downstream.** Panels are
  extracted from it — never from an AI-generated flat artboard, never from a
  crop of a 3D vehicle render.

#### The three zones (from the owner's reference sheet)

| Zone | Contents | Count | Rule |
|---|---|---|---|
| **ZONE 1 — FULL DESIGN PANELS** | photo + design + text + logo | **7 panels** | Complete wrap artwork, rectangle panels |
| **ZONE 2 — BACKGROUNDS ONLY** | background artwork, **no text or logo** | **7 panels** | **Must match Zone 1 EXACTLY** — same artwork, branding removed |
| **ZONE 3 — CUT GRAPHICS** | logo, tagline, phone, website, icon | vector elements | **Vector cut paths, NO background** |

Zone 2 is not a separate design. It is Zone 1 with the branding absent — the
same pixels underneath. It must be authored logo-free, never stripped or healed
out of Zone 1 (healing smears).

Zone 3 elements are the real branding assets lifted as cut-ready vector paths,
each with its own dimensions (e.g. PRIMARY LOGO 72.0" W x 24.0" H, TAGLINE
54.0" x 8.5", PHONE 36.0" x 8.0", WEBSITE 60.0" x 6.0", ICON 48.0" x 14.0").

#### The 7 panels

Driver Side · Passenger Side · Hood · Roof · Front Bumper · Rear (split) ·
Rear Bumper.

Every panel is **dimensioned by Universal GENIE** and carries a **5" bleed on
all four edges**. Each panel shows, on the sheet: overall W x H, the TRIM size
in parentheses, and the square footage with bleed. Example row from the
reference (2024 Ford F-250 Crew Cab):

| Panel | Size (with bleed) | Trim | Sq ft |
|---|---|---|---|
| Driver Side | 232.5" x 63.0" | 227.5" x 58.0" | 101.4 |
| Passenger Side | 232.5" x 63.0" | 227.5" x 58.0" | 101.4 |
| Hood | 73.0" x 60.5" | 63.0" x 50.5" | 30.7 |
| Roof | 156.0" x 60.5" | 146.0" x 50.5" | 65.6 |
| Front Bumper | 121.5" x 39.0" | 111.5" x 29.0" | 32.9 |
| Rear (split) | 73.5" x 60.0" | 63.5" x 50.0" | 30.6 |
| Rear Bumper | 121.0" x 39.0" | 111.0" x 29.0" | 32.8 |

The sheet also carries a header block (DATE, ORDER #, DESIGNER, VERSION), the
design name / finish / **TOTAL COVERAGE in SQ FT**, a **PANEL DIMENSIONS
REFERENCE (TRIM SIZE)** strip, TEMPLATE NOTES, and a GUIDE legend
(panel trim line / 5" bleed area / safe zone). **All of that is DRAWN BY CODE,
never prompted** — an AI asked to letter a dimension will invent one.

Safe-zone rule from the sheet: keep important elements **at least 3" from the
trim line**.

### VEHICLE DIMENSIONS — position in the chain (OPEN DECISION, see below)

- The system pulls the dimensions for **the vehicle the customer enters**.
- Originally specified at **Call 1**.
- Owner's revised instinct: **it may be smarter to attach dimensions at Call 2**
  (the 3D vehicle proof).
- **This is not yet decided.** See "Open decisions" at the end of this file
  before implementing either way.

### CALL 1 → CALL 2 — must route through our own design stack

- The hand-off from Call 1 to Call 2 **must use our suite of custom design edge
  functions.** Not a generic re-prompt, not a third-party pass.

### CALL 2 — 3D VEHICLE PROOF, SIDES 1–7

- Call 2 produces the **photorealistic 3D vehicle proof**.
- **The Production Panel Proof from Call 1 is shown to the AI on Call 2**, so it
  can quickly and accurately wrap the photoreal vehicle with the design that
  already exists. The 3D proof reproduces Call 1's design — it does not invent a
  new one.
- **ALL SIDES MUST BE GENERATED — 7 ANGLES.** Not a hero plus a few. Seven.
- **Sides 1–7 generate in PARALLEL.**
- **As each side finishes it is automatically shown to the customer.** Progressive
  reveal — the customer does not wait for all 7.

### ATLAS TOPOLOGY PROOF — built by the DAG engine

- Once all 7 views are generated in parallel, the system — **using our DAG
  engineering** — creates the **ATLAS Topology Proof**.
- ATLAS is built **from the Call 1 Production Panel Proof**, with a **5" bleed
  added.**
- ATLAS is NOT built from the 3D renders.

### HAND-OFF — what goes where

Three artifacts are sent to **PanelProStudio**:

1. **ATLAS Topology Proof**
2. **Production Panel Proof** (Call 1)
3. **3D designs** (Call 2, sides 1–7)

The **customer** is sent to **RevisionStudioIQ**.

### REVISIONSTUDIOIQ — refine + entice

- The customer can **refine the design** here.
- The **right column** shows the **Production Panel Proof and the panels** —
  this is the **ENTICE surface**, shown to make them want to buy.
- **Under the panels** there is an **"Order Production Files" button.**

### ON PURCHASE — paid path only

- Once they buy, the **panels from ATLAS are processed by being UPSCALED.**
- The customer is sent to the **GENIE Universal Panelizer progress page.**

### HUMAN / AI FILE OUTPUT — the QC gate

Our design team, per panel:

1. **Reviews each panel file.**
2. **Downloads the text overlays.**
3. **Applies them to real templates to validate them.**
4. **Check-marks quality approval.**

Once the designer check-marks quality approval:

- The system **stamps the proofs**.
- The system **creates the ZIP file.**

---

## Open decisions — DO NOT implement past these without a ruling

### 1. Dimensions at Call 1 or Call 2?

Owner raised this and has not ruled. Engineering read, for the record:

There are **two different things** being called "dimensions," and separating
them probably dissolves the question:

- **RESOLVING** the vehicle's true per-side dimensions (a deterministic lookup
  against the vehicle the customer entered).
- **STAMPING** the visible dimension callouts onto a proof.

**Resolution must happen BEFORE Call 1 composes**, because Call 1's zone aspect
ratios have to match the real panel aspect ratios. If Call 1 is composed at the
wrong proportions, every panel extracted from it inherits distorted geometry and
no downstream step can undo it.

**Stamping can happen later, and should be DRAWN BY CODE, never prompted.** An
AI asked to letter a dimension will invent a plausible one.

So the recommendation is neither "Call 1" nor "Call 2" but **Call 0: a
deterministic, zero-AI dimension resolve at intake**, consumed by Call 1 for
geometry and by Call 2 for the stamp. Awaiting owner's ruling.

### 2. The 3-zone layout reference image — RECEIVED 2026-09-21

The owner's reference sheet (Ridgeline Custom Pools / 2024 Ford F-250 Crew Cab)
was supplied and its zone breakdown is captured in the Call 1 section above.
The matching Call 2 reference (photoreal driver-side F-150 in a white studio,
wrap reproducing the Zone 1 driver panel exactly) was supplied at the same time.
**Store both in the repo as the golden reference pair** so Call 1 and Call 2
output can be diffed against them after every change.

---

## Invariants this spec inherits (do not violate)

- **Panels come from the Call 1 Production Panel Proof, deterministically.**
  Never from an AI-generated flat artboard. That is the source of "AI slop
  panels."
- **Nothing ships to the upscaler or to production before payment.** The entice
  surface is pre-order; the upscale is post-purchase only.
- **A vault flag is not a shipped pack.** Report status from the pack's own
  per-side provenance, never from a `deterministic: true` flag sitting in a
  table.
- **Never state how long a wrap lasts** in anything AI writes.
