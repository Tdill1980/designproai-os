# PANEL DATA SLUG + PANEL MAP (owner ruling, Trish 2026-09-02)

Owner, from Brice's print sample (a panel with the Caldera RIP's info band along
one edge): **"Brice has mandatory panel data that needs to be printed on one
side of each panel. This is how he needs it set up in design."** Then: **"It's
not currently in the panel design edge, I need to add it to the contract, your
job, own it."** And: **"Design team must be able to see it and read it during
PanelProStudio mandatory qc checks."**

## What it is

Every production panel leaves the OS with its own data printed along one edge,
OUTSIDE the bleed. The RIP's band says how a file was printed (printer, media,
resolution, profiles, screening). The slug says what the file IS: order,
DesignID, generation, revision, customer, vehicle, surface, trim, print, bleed,
square feet, file hash, master hash, GENIE manifest hash, density, build time,
and a QC-approved line.

It is rendered by code from the **panel map** and nothing else, so the printed
strip and the OS record cannot disagree.

## Where it lives

| artifact | strip | source | why |
|---|---|---|---|
| canonical Call-1 panel | **none** | — | RULE 0.15: the canonical panel is one pure rectangle of artwork. Never touched. |
| Call 11 `qc-panel` duplicate | 120 px, bottom edge | design-phase panel map | read on the PanelPro board at preflight, before Topaz and output exist |
| production `output` PNG / TIFF / EPS | 1.5" = 225 px at 150 PPI full scale, bottom edge | production-phase panel map | the strip Brice's floor reads on the printed vinyl |

Geometry of a production file: artwork = (trim + 10") × 150 px/in exactly as
before; the file is 225 px taller; trim and bleed are unchanged. The artifact
declares `slugContract`, `slugEdge`, `slugInches`, `slugPixels`,
`artworkHeightPixels` and `slugLines`; the EPS header declares
`%%DesignProAI-PanelDataSlug: bottom 1.5 225` and
`%%DesignProAI-ArtworkHeightPixels`. `output.verify` refuses a file whose
pixel height is not artwork + strip, or that does not declare the strip
(`output_artifact_slug_missing`, `output_eps_slug_required`,
`output_eps_slug_invalid`).

Owner defaults until Brice overrides them: **bottom edge, 1.5"**, white ground,
black text, hairline across the top, a cut mark at each end, `TRIM STRIP - NOT
ARTWORK` at the right end. Edge and height are constants in
`runtime/panel-data-slug.cjs` and `runtime/output-qc.cjs`; changing them is a
contract change and moves the verification with it.

## The lines (rendered from the map)

```
DESIGNPROAI | PANEL DATA   DRIVER SIDE   [UP ^]  [FRONT <-]
Order RP-101204   DID-1A0E6B70   Gen 1a0e6b70   Rev 16154e4d (V1)
Customer: Precision Climate Solutions   Vehicle: 2022 Ford F250 Crew Cab (truck)
Trim 153 x 56 in   Print 163 x 66 in (5 in bleed all sides)   59.5 sq ft   GENIE validated
File driver.tiff   sha256 e0e19b53bfa7...   Master e391c2cca6a7...   GENIE 766258a0
Output 150 PPI full scale (native 20.68 PPI, x7.25)   sRGB   Media: per order
Built 2026-09-02T21:28:38Z   QC approved: ________________________  (blank until stamped)
```

The design-phase strip (QC panels) says `design-time sizing, NOT validated` and
`Order not assigned` until GENIE validates the vehicle and the pack is ordered.
Nothing on the strip is ever defaulted to look complete.

## The panel map (`designpro.atlas-panel-map.v1`, artifact kind `panel-map`)

One JSON per run and phase, content-addressed, listed beside the master and the
six panels, carried in the ZIP and to WrapBox:

| field | content |
|---|---|
| `phase` | `design` (Call 9) or `production` (output.build) |
| `generationId`, `revisionId`, `revisionSequence`, `designId`, `orderNumber`, `customerName` | identity |
| `vehicle` | year, make, model, body, `geometrySource`, `productionSizingValidated` |
| `genie` | manifest id + hash (v2), prep id |
| `master` | sha256, storage path |
| `surfaces.<key>` | `trimIn`, `printIn`, `bleedIn`, `sqFt`, `file {sha256, storagePath, px, role}`, `nativePpi`, `printTargetPpi`, `upscaleFactorRequired`, `sourceMasterHash`, `onMaster` / `trimOnMaster` when known, `noseEdge`, `proofShots` |

Every `surfaces.*.sourceMasterHash` must equal `master.sha256`
(`panel_map_master_split` otherwise): a map naming two masters is the split
lineage RULE 0.27 forbids.

## The QC boxes

`await_panelpro_preflight_qc` runs BEFORE Topaz and output, so at preflight the
team reads the strip on the six QC panels. `await_final_human_qc` runs after
`output.verify`, so the production strip is read there.

| gate | key | the person attests |
|---|---|---|
| PanelPro preflight | `panelDataSlugVerified` | the slug on every QC panel was read and every field matches the panel map |
| final production QC | `productionSlugVerified` | every production PNG/TIFF/EPS carries the slug on the bottom edge, 1.5" outside the bleed, and its fields match the panel map |

Both are enforced by `approve_designpro_human_gate` (migration
`20260903000000`, a text patch of the live body), listed by the gateway, the
shared checklist (`app/src/lib/designpro-stages.ts`) and the QC certificate.
The PanelPro control room shows, per surface, the strip cropped from the QC
panel at 1:1 pixels beside the same fields as text, so the designer verifies by
comparison.

## Code

| piece | file |
|---|---|
| panel map builder, parser, slug lines | `runtime/panel-map.cjs` |
| strip renderer + canvas extension | `runtime/panel-data-slug.cjs` |
| design map at Call 9, slug on QC panels at Call 11, production map + slug at output.build | `runtime/designpro-standalone-claimant.cjs` |
| geometry contract + verification | `runtime/output-qc.cjs` (`PANEL_DATA_SLUG`) |
| certificate rows | `runtime/qc-certificate.cjs` |
| locks | `tests/panel-data-slug.test.mjs`, `supabase/tests/panel_data_slug_gate.test.sql` |
