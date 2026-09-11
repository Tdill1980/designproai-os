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

## What was recovered (RULE 1: recover before you invent)

Copied from `Tdill1980/restylepro-os` @ `721128e6` (2026-09-11) into
`supabase/functions/`, then adapted only where the DesignProAI boundary
demands it:

| function | role | delta |
|---|---|---|
| `generate-graphics-pro` | surface / mockup / flat / dimension lookup / logo job / `run_production` | bucket → `graphicspro-files`; PDF stage → `cut-contour-build`; RestylePro `production_flow_assets` vault write dropped |
| `graphicspro-on-vehicle-photo` (+ `prompt.ts`) | MyVehiclePro for GraphicsPro | accepts `colorData.designUrl` (the approved mockup) as **IMAGE 2**, transfer prompt modelled on the proven DesignProAI transfer branch of `myvehicle-prompt-builder.ts`, `temperature 0.05` when a reference is present |
| `edit-vehicle-photo` (+ `_shared/myvehicle-prompt-builder.ts`) | the shared MyVehiclePro fallback `pickMyVehicleEndpoint` names | bucket; `vehicle_year` coalesced to 0 (NOT NULL here) |
| `cut-graphics-proof` | dimensioned cut-graphics spec (W×H, letter height, plotter fit) | none |
| `cut-contour-build` | deterministic pdf-lib CutContour PDF (100% magenta keyline, 0.5″ bleed, reg marks) | bucket |
| `cut-map` (+ `_shared/replicate-bg-remove.ts`) | CUT-MAP™ per-element contour pack | bucket |
| `generate-cut-files` (+ `_shared/vtracer/`) | element extraction + VTracer vectorization ZIP | bucket |
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
  Cut Path Proof PDF (generate_flat → cut-contour-build) · studio angles (generate-color-render)
  MyVehiclePro (vehicle jobs): customer photo + designUrl=mockup → graphicspro-on-vehicle-photo
Approve → Step 3 · Production (run_production)
  Topaz upscale → CUT-MAP™ contour SVG → cut files ZIP → CutContour PDF → pricing → complete
  ProductionOutput polls graphics_pro_jobs and lists every file
```

## Secrets the DesignProAI project needs

Set through `deploy-edge-functions.yml` (each optional one degrades to a
recorded no-op inside `run_production`):

| secret | used by | without it |
|---|---|---|
| `GOOGLE_AI_API_KEY` (already set) | every Gemini call | nothing renders |
| `TOPAZ_API_KEY` | `run_production` stage 1 | print file ships un-upscaled |
| `REPLICATE_API_TOKEN` | `cut-map` | no per-element contour pack |
| `VECTORIZE_DROPLET_URL` | `vectorize-it` (studio production pack) | 503 `configured:false` |

## Acceptance — the owner's eye, not a green suite

Nothing below is proven until a fresh generation on the deployed release shows
it. Leave unchecked until then.

- [ ] `deploy-edge-functions.yml` dispatched for the eight GraphicsPro functions; `list_edge_functions` shows them
- [ ] migration applied through the release gate; `graphicspro-files` public bucket present
- [ ] `/graphics-pro-wall`: upload a wall photo → Konva ZoneMasker shows the photo → draw two zones → mockup returns with graphics inside the zones → Cut Path Proof PDF opens with the artwork and the magenta keyline
- [ ] `/graphics-pro` vehicle: upload driver-side photo → zones → mockup → MyVehiclePro on a second photo shows the SAME graphic
- [ ] Approve → `run_production` reaches `complete` with print file, CutContour SVG (if REPLICATE set), cut files ZIP, CutContour PDF and pricing

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
