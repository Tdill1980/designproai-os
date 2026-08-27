# Canonical DesignProAI Design → Panel Files Orchestration

Owner directive: one clean product graph. No second creative stack. No 3D-first design authority. No UI-side panel production.

## 1. Call 1 — one creative design authority

```text
Customer brief / YMM / business data / supplied logo / VisionBoardIQ
                         ↓
REAL design-panel-ai-generate / DesignIQ
                         ↓
ONE Gemini image authoring call
                         ↓
ONE cohesive flattened A.T.L.A.S. source master
```

`design-panel-ai-generate` owns the professional creative decision: commercial/restyle interpretation, logo behavior, depth, texture, hierarchy, translation of the requested concept, exact customer text and VisionBoard/reference handling.

A.T.L.A.S./GENIE owns the flattened topology, surface geometry and lineage. No downstream stage may redesign this source.

## 2. Master accepted → immediate independent fan-out

As soon as the source master passes deterministic master acceptance:

```text
master.accepted
      ├── driver panel     → persist → publish → Driver 3D + Close-Up
      ├── passenger panel  → persist → publish → Passenger 3D
      ├── hood panel       → persist → publish → Hood 3D
      ├── front panel      → persist → publish → Front 3D
      ├── rear panel       → persist → publish → Rear 3D
      ├── roof panel       → persist → publish → Roof 3D
      └── logo/assets extraction
```

The extraction priority is Driver → Passenger → Hood → Front → Rear → Roof, but priority is not a dependency barrier. Each node starts when its own input exists.

Every panel is deterministic, content-addressed and must carry:

- `surfaceKey`
- `sourceMasterHash`
- `contentHash`
- trim dimensions
- print dimensions
- exactly 5 inches bleed on every edge (`print = trim + 10in` in each dimension)
- generation/revision lineage

A failed or slow 3D proof can never prevent a production panel from existing.

## 3. 3D proofs — presentation only

Each proof receives its matching extracted panel as artwork authority.

```text
MATCHING EXTRACTED PANEL
+ exact YMM/configuration
+ view-angles-os camera/framing authority
+ studio-os studio + lighting authority
+ photorealism/photographer presentation contract
                         ↓
ONE photorealistic 3D proof
```

Canonical seven views:

1. Driver / `side`
2. Passenger / `passenger-side`
3. Hood / `hood_detail`
4. Front / `front`
5. Rear / `rear`
6. Close-Up / `close-up` (Driver surface detail authority)
7. Roof / `roof`

Driver is dispatched first for customer latency. It is not a creative anchor and other views do not wait for it.

A 3D proof may change camera, perspective, studio, lighting and physical vinyl presentation. It may not redraw, simplify, recolor, move or invent source artwork.

Each proof must persist:

- `generationId`
- `atlasRevisionId`
- `masterContentHash`
- `sourceViewType`
- `surfaceKey`
- `sourcePanelHash`
- output hash
- angle/studio/photography contract versions
- QC evidence

## 4. Progressive UI publication

RevisionStudioIQ and PanelPro Admin Studio are consumers of the same persisted artifacts.

As soon as a panel exists, publish it. As soon as its proof exists, add the proof next to that exact panel.

RevisionStudioIQ customer surface:

```text
3D PROOF | MATCHING PANEL + 5in BLEED
```

plus allowed downloads, revision/prompt history and extracted brand assets.

PanelPro Admin Studio receives the complete technical record:

- Generation ID
- Design ID
- design/order number
- exact YMM/configuration
- exact initial + revision prompts with timestamps
- every ATLAS V1/V2/V3 master
- every extracted panel/version
- every 3D proof/version
- extracted logos/assets
- hashes and lineage
- dimensions/effective DPI
- machine evidence
- human QC records
- source and upscaled derivatives
- downloads

Neither UI may create, mirror, upload, crop or regenerate production panels.

## 5. Production files

Approved production panels continue through the production branch without replacing the source artifact:

```text
SOURCE PANEL
    ↓
UPSCALED DERIVATIVE (when required)
    ↓
ACTIVE PRODUCTION DERIVATIVE
    ↓
Build Print Files
    ↓
TIFF + PNG
    ↓
Production Pack / metadata sheet / proofs
    ↓
ZIP
    ↓
WrapBox
```

The original source panel remains immutable and downloadable. Upscale/output assets are derivatives with their own hashes, dimensions, effective DPI, timestamps and QC state.

## Hard invariants

```text
ONE revision = ONE creative DesignPanelAI authoring call = ONE A.T.L.A.S. master

ONE accepted master → SIX deterministic production panels

ONE proof view → ONE matching extracted panel as artwork authority

RevisionStudioIQ and PanelPro → SAME persisted artifacts

3D proofs = presentation only

failed proof ≠ failed panel
```

Executable form: `runtime/design-to-panel-orchestrator.cjs`.
