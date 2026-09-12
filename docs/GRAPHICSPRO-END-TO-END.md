# GraphicsPro — end to end in designproai-os (2026-09-11)

GraphicsPro designs **cut-contour vinyl graphics** for three surfaces — a
wall, a vehicle, a storefront window — on the **customer's own photo**, with
the vinyl zones drawn on that photo in a **Konva** canvas (ZoneMasker), and
lets the customer see the approved graphic on their real vehicle through
**MyVehiclePro**. This document records what was found, what was recovered,
the deliberate deltas from RestylePro, what a fresh generation must prove, and
the plan for the second step the owner asked for: migrating the heavy stages
onto the DesignProAI server (droplet runtime).

Locks: `tests/graphicspro-end-to-end.test.mjs` (static contracts) and
`supabase/tests/graphicspro_cut_contour.test.sql` (schema, on the shadow gate).

## What was measured before touching anything

| half | state on 2026-09-11 |
|---|---|
| React product (`pages/GraphicsProV1.tsx`, `GraphicsProWall.tsx`, `components/graphicspro-v1/*`, `hooks/useGraphicsProV1Logic.ts`, `hooks/useCutGraphicsProof.ts`, `components/tools/MyVehicleProInline.tsx`) | byte-identical to `restylepro-os` (`diff` = 0 lines) — **but not routed**: `App.tsx` declared no `/graphics-pro` route, so the pages were dead code |
| Edge functions the browser invokes (`generate-graphics-pro`, `graphicspro-on-vehicle-photo`, `edit-vehicle-photo`, `cut-graphics-proof`, `cut-contour-build`, `vectorize-it`) | **absent** from this repository and **absent** from the DesignProAI Supabase project (`wozyamlnygaddievzuwn`, `list_edge_functions`) |
| Tables (`graphics_pro_jobs`, `graphics_pro_pricing`, `shop_pricing_config`) | **absent** on the DesignProAI project; `color_visualizations`, `blocked_users`, `user_tokens`, `user_roles`, `vehicle_dimensions` present |
| Storage | `wrap-files` is **private** here (RULE 0.29: "a public URL 400s"); every GraphicsPro consumer — `<img>`, the Konva image node, `composeZoneOverlay`'s canvas, and Gemini's reference fetch — needs a public URL |
| MyVehiclePro for GraphicsPro | broken **in RestylePro too**: `MyVehicleProInline` sent colour fields only; `graphicspro-on-vehicle-photo` returns `400 Styling prompt required` on every click, and never received the mockup, so even with a prompt it would have invented a different design |
| `quick-prep-pdf-export` (RestylePro's run_production PDF stage) | its hand-written PDF's content stream contains only comments — the artwork is never drawn. The "Production PDF" it returned opens blank |

## The cut-contour files are produced, not approximated (owner, 2026-09-11: "it must design and produce cut contour designs and files")

The first port only drew a magenta rectangle around a raster. That is not a
cut-contour file. The WePrintWraps guide (Nate, *How to output cut contour
graphics*, `docs/…` upload 2026-09-11) is now executed deterministically by
`supabase/functions/_shared/cut-contour/` and served by `cut-contour-build`:

| Nate's Illustrator step | what the producer does | where |
|---|---|---|
| three layers: cutline / artwork / bleed | PDF optional-content groups `CutContour`, `Artwork`, `Bleed` (+ `Film n` for film cut); SVG `<g id>` groups | `produce.ts` |
| Pathfinder → Unite → outer silhouette | pixel-boundary trace of every element (holes included), RDP simplify, Chaikin round, re-simplify | `geometry.mjs` `traceBoundaries` / `cleanLoop` |
| swap fill/stroke, new swatch **CutContour**, spot, CMYK 0/100/0/0 | a real PDF `Separation /CutContour /DeviceCMYK` with tint transform C1 = [0 1 0 0]; the cut path is `CS … 1 SCN 0.25 w … S` — a 0.25 pt stroke, never a fill | `produce.ts` |
| Offset Path 1/4" on the bleed layer | Euclidean distance transform; the ring 0.25" outside the cut line is painted with the nearest artwork colour (the colour "goes a little bit further past the cut line") | `edt` / `bleedRing` |
| Type → Create Outlines | a traced silhouette is already vector shape | — |
| nest everything on one sheet ≤ 51.5" high, fit to artwork bounds | column packing, rotation when that is the only fit, oversize flagged for tiling; sheet inches are the order size | `shelfPack` |
| files at 10% scale named "… 10%" when huge | sheets beyond the 200" PDF page limit are written at 10% scale with the scale in the file name, subject and SVG | `produce.ts` |
| letters < 2", hairline detail → manual review (WPW File Prep: "contact us prior to ordering") | `letters:` (a run of ≥ 3 similar shapes on a line under 2"), `hairline:` (< 0.05" feature), `vertices:` (> 200), `oversize:` flags; the dimensioned letter-height spec stays with `cut-graphics-proof` | `smallLetterRuns` / `minFeatureWidth` |
| "Layered vector files are required" | Manufacture Film Cut kits are **vector end to end**: one visible layer per film colour (fills as paths) + each film's offset-path bleed in its colour + the CutContour stroke; no raster in the file. Print & Cut keeps the artwork as a raster inside the vector-layered file (photographic art has no vector form; the cut line and the layer structure are vector) | `quantizeColors` / `dilate` |

### Walls, windows and vehicles: one tool, one kit, three application rules

| surface | entry | photo + Konva zones | what differs in the kit |
|---|---|---|---|
| Wall | `/graphics-pro-wall` (wall pre-selected) or `/graphics-pro` | `wallPhotoFile` → ZoneMasker on the wall photo → `surface.vinylZones` | flat art briefed "read from across a room"; bleed / cut line / nesting identical |
| Window / storefront | `/graphics-pro-window` (glass pre-selected) or `/graphics-pro` | `glassPhotoFile` → ZoneMasker on the storefront → `surface.vinylZones`; day / night / headlight mockups | **interior mount = reverse cut**: the whole kit is mirrored (`mirror: true`, file suffix `-reverse`, "REVERSE CUT" in the PDF subject) so it reads correctly from the street; exterior mount is cut as drawn |
| Vehicle | `/graphics-pro` | built preview (`generate_surface`) with ZoneMasker, or uploaded angles each with their own ZoneMasker → `uploadedAngles[].zones`; MyVehiclePro on the customer's own photo | flat art briefed "one graphic per body panel"; kit reads the zones from every angle |

`run_production` and the Cut Contour Kit button take the zones from wherever the surface stores them, so the measured inches reach the producer on all three paths.

Inputs: the FLAT artwork (`generate_flat`, briefed as cut-ready: pure white
background, solid closed shapes, no soft edges, film-cut = flat solid colours
only) and the real print size from the customer's measured zone (else the
first line item; else 150 DPI and the response says so). Outputs: PDF, SVG,
ZIP (PDF + SVG + `manifest.json` with the sheet size to order), the element
list, review flags. `run_production` uses the same call for stages 2–4 and
prices the nested sheet.

Proof: `tests/cut-contour-geometry.test.mjs` (node, pure geometry on known
shapes) and `supabase/functions/_shared/cut-contour/produce.test.ts`
(`deno test --allow-net --allow-read …`: Separation colour space, layers,
stroke operators, nesting, 10% fallback, film layers). `cut-map`,
`generate-cut-files`, VTracer and the Replicate matte are gone: nothing on
the cut line needs a model or a secret.

## What was recovered (RULE 1: recover before you invent)

Copied from `Tdill1980/restylepro-os` @ `721128e6` (2026-09-11) into
`supabase/functions/`, then adapted only where the DesignProAI boundary
demands it:

| function | role | delta |
|---|---|---|
| `generate-graphics-pro` | surface / mockup / flat / dimension lookup / logo job / `run_production` | bucket → `graphicspro-files`; flat prompt briefed as cut-ready input; stages 2–4 → one `cut-contour-build` call; pricing on the nested sheet; RestylePro `production_flow_assets` vault write dropped |
| `graphicspro-on-vehicle-photo` (+ `prompt.ts`) | MyVehiclePro for GraphicsPro | accepts `colorData.designUrl` (the approved mockup) as **IMAGE 2**, transfer prompt modelled on the proven DesignProAI transfer branch of `myvehicle-prompt-builder.ts`, `temperature 0.05` when a reference is present |
| `edit-vehicle-photo` (+ `_shared/myvehicle-prompt-builder.ts`) | the shared MyVehiclePro fallback `pickMyVehicleEndpoint` names | bucket; `vehicle_year` coalesced to 0 (NOT NULL here) |
| `cut-graphics-proof` | dimensioned cut-graphics spec (W×H, letter height, plotter fit) | none |
| `cut-contour-build` | file-prep mode rebuilt on the deterministic producer above (silhouette cut line, spot colour, bleed, nesting, PDF + SVG + ZIP); ORDER mode untouched | bucket + producer |
| `vectorize-it` | proxy to the vectorize server | **no hard-coded RestylePro droplet IP**; `VECTORIZE_DROPLET_URL` required, 503 with a reason when unset |

Schema: `supabase/migrations/20260911210000_graphicspro_cut_contour.sql` —
the live RestylePro shapes read back from `information_schema` and
`pg_constraint`, with these deliberate deltas: no FKs to `shop_profiles` /
`quotes` (RestylePro tables), `surface_type` admits `'studio'` (the UI's
`SurfaceType` union has carried it; the live CHECK rejected every studio job
insert), `shop_pricing_config.user_id` is UNIQUE (the upsert always needed
it), and a new **public** bucket `graphicspro-files` with browser uploads
confined to `renders/{uid}/…`.

Routing: `/graphics-pro` (vehicle / wall / glass / studio picker),
`/graphics-pro-wall` (wall pre-selected), `/graphicspro` → redirect; sidebar
entry `graphicspro` (tier `complete`, matching `TOOL_TIER_REQUIREMENTS`).

## The customer path, as wired

```text
Step 1 · Setup
  surface: upload the customer's photo (wall / storefront / one or more vehicle angles)
           or build one (year/make/model → generate_surface; wall texture; glass type)
  ZoneMasker (react-konva Stage): draw the vinyl zones ON that photo, name them,
           enter real inches (CSV vehicle DB → lookup_dimensions → manual)
  graphic:  design / commercial / upload / restyle / logo · VisionBoard intent · finish
Generate
  uploadAllFiles → graphicspro-files (renders/{uid}/GraphicsProV1/…)
  composeZoneOverlay burns the Konva rectangles into the photo → uploaded
  generate_mockup: [overlay, clean photo, artwork, logo, restyle, visionboard] → Gemini
  → graphics_pro_jobs row (vinyl_zones + zone_overlay_url persisted), status mockup_ready
Step 2 · Preview
  Before (zones drawn) ∥ After (mockup) · Day/Night re-render · Revise · Approve
  Cut Graphics Proof (cut-graphics-proof) · 2D Production Proof (generate-2d-proof)
  Cut Contour Kit (generate_flat → cut-contour-build: PDF + SVG + ZIP, sheet size to order) · studio angles
  MyVehiclePro (vehicle jobs): customer photo + designUrl=mockup → graphicspro-on-vehicle-photo
Approve → Step 3 · Production (run_production)
  Topaz upscale → cut-contour-build: silhouette cut line (CutContour spot) + 1/4" bleed
  + nested sheet → PDF, SVG, ZIP → pricing on the nested sheet → complete
  ProductionOutput polls graphics_pro_jobs and lists every file
```

## Secrets the DesignProAI project needs

Set through `deploy-edge-functions.yml` (each optional one degrades to a
recorded no-op inside `run_production`):

| secret | used by | without it |
|---|---|---|
| `GOOGLE_AI_API_KEY` (already set) | every Gemini call | nothing renders |
| `TOPAZ_API_KEY` | `run_production` stage 1 | print file ships un-upscaled |
| `VECTORIZE_DROPLET_URL` | `vectorize-it` (studio production pack) | 503 `configured:false` |

The cut line, bleed, nesting and CutContour PDF need no secret.

## Acceptance — the owner's eye, not a green suite

Nothing below is proven until a fresh generation on the deployed release shows
it. Leave unchecked until then.

- [ ] `deploy-edge-functions.yml` dispatched for the eight GraphicsPro functions; `list_edge_functions` shows them
- [ ] migration applied through the release gate; `graphicspro-files` public bucket present
- [ ] `/graphics-pro-wall`: upload a wall photo → Konva ZoneMasker shows the photo → draw two zones with inches → mockup returns with graphics inside the zones → Cut Contour Kit: the PDF opens in Illustrator with a `CutContour` spot swatch, the cut line follows the silhouette of each graphic, the bleed shows the artwork colour outside the cut line, the sheet size matches what the kit reports
- [ ] `/graphics-pro-window`: upload a storefront photo → zones → mockup (day and night) → with Interior mount selected the kit is mirrored and named `-reverse`; with Exterior it is not
- [ ] `/graphics-pro` vehicle: upload driver-side photo → zones → mockup → MyVehiclePro on a second photo shows the SAME graphic → kit uses the driver-side zone inches
- [ ] Approve → `run_production` reaches `complete` with print file, CutContour SVG, kit ZIP, CutContour PDF and pricing on the nested sheet
- [ ] A kit PDF sent to the plotter RIP (VersaWorks / Onyx) routes the magenta path to the blade, not the print head

## Step two — migrate the heavy stages to the DesignProAI server

The edge port above is the "fix current GraphicsPro" half. Everything that hit
Supabase's 256 MB worker limit in RestylePro (VTracer on real wrap art, the
4K Topaz pass, BiRefNet mattes) belongs on the droplet runtime, as graph nodes
in the pattern `runtime/wallpro-production.cjs` already uses (RULE 0.35
addendum: durable node graph, per-node retry, both workers draw):

1. `request_graphics_pro_production(job)` RPC + `claim_graphics_pro_production_node` (FOR UPDATE SKIP LOCKED), nodes `upscale → cutmap → cutfiles → pdf → price`, mirroring `20260911190000_wallpro_production_jobs.sql`.
2. `runtime/graphicspro-production.cjs`: Topaz through the same `enhancePanel` Call 12 uses; VTracer via the runtime's vectorize server (this is the `VECTORIZE_DROPLET_URL` target); pdf-lib PDF identical to `cut-contour-build`.
3. `generate-graphics-pro` `run_production` becomes a thin `request_*` call; `ProductionOutput` keeps polling the same `graphics_pro_jobs` columns, so the UI does not change.
4. Move files to a private bucket with signed reads once the runtime owns the reads (Gemini reference fetches then go through the runtime, not public URLs).

Not started here on purpose: the owner asked for the fix first, then the
migration. Nothing in this change touches Calls 1–12, WallPro, or the
A.T.L.A.S. contracts.

## Known limits, stated plainly

- `QCCutContour.tsx` (admin QC artboard) still reads `panelizer_jobs` with
  `concept_json.source = 'graphicspro_studio'`, which the studio pack path no
  longer writes (it writes `graphics_pro_jobs`, per the hook's own comment).
  It is not routed; fixing it is part of step two.
- `graphicspro-files` is public by design of the recovered code. Customer
  photos are reachable by URL. Step two moves them behind signed reads.
- The `generate-color-render` studio-angle fill and `generate-2d-proof` are
  the functions already deployed on this project; their GraphicsPro branches
  were not re-verified live by this change.
