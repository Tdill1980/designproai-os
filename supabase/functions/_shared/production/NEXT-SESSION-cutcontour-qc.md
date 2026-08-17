# Next Session — CutContour QC Artboard for GraphicsPro Studio

Goal: build the **real ProductionFlow QC Artboard** for cut-contour
GraphicsPro Studio jobs, following the exact same shape as the
existing DesignPro QC Artboard.

## What already exists (do NOT rebuild)

| Piece | Location | What it does |
|---|---|---|
| DesignPro QC Artboard page | `src/pages/QCArtboard.tsx` (3,842 lines) | Polls `panelizer_jobs`, renders extracted elements on an artboard, lets admin approve / reject / revise |
| Route | `src/App.tsx` line 479 → `/qc-artboard` (RequireAdmin) | Admin-only entry point |
| QC backend | `supabase/functions/panelizer-qc-artboard/index.ts` | Job-side QC orchestrator |
| Text/mask detection | `src/components/qc/TextMaskTool.tsx` + `src/hooks/useTextMaskDetect.ts` | Gemini Vision detects text/logos, sends to vectorize-it |
| QC rails | `src/components/proof/QcJobsRail.tsx` | Lists jobs needing QC |
| Pull from QC | `src/components/proof/PullFromQCDialog.tsx` | Hand a QC'd job back to the pipeline |
| WPW spec | `supabase/functions/_shared/production/wpw-cut-contour-spec.md` | Canonical CutContour requirements |

## What Studio writes that QC needs to read

When `generateStudioProductionPack` finishes it updates the row at
`panelizer_jobs.id = jobId` with:

```ts
{
  cut_path_svg_url: <vectorize-it output>,
  status: 'needs_qc_review' | 'ready_for_production',
  concept_json: {
    source: 'graphicspro_studio',
    cut_style: 'printed' | 'cut',
    bleed_inches: 0 | 0.125 | 0.25,
    wpw_spec: {
      spot_color_name: 'CutContour',
      spot_color_cmyk: { c: 0, m: 100, y: 0, k: 0 },
      stroke_weight_pt: 0.25,
      stroke_fill: 'none',
      layer_order: ['cut', 'art', 'bleed'],
      bleed_color: 'black',
      bleed_offset_join: 'round',
    },
    layers: [
      { index, label, copy, width_inches, height_inches, film },
    ],
    review_flags: ['letters_under_2in:Zone 1', 'missing_film:...'],
  },
}
```

That's the input contract — the QC page just needs to filter rows
where `concept_json.source === 'graphicspro_studio'` and render.

## Recommended next-session build order

### 1. New page — `src/pages/QCCutContour.tsx`

DO NOT extend the existing `QCArtboard.tsx` — it's 3,800 lines of
vehicle-panel logic that doesn't apply to flat studio output.
Make a parallel page that follows the same component pattern but
operates on flat artboards.

Skeleton:
```tsx
// /qc-cutcontour — admin-only, follows QCArtboard layout shape
// - Left rail: list of panelizer_jobs where concept_json.source =
//   'graphicspro_studio' AND status IN ('needs_qc_review',
//   'ready_for_production'). Order by created_at desc.
// - Center canvas: render the SVG from cut_path_svg_url on a
//   white artboard. Toggle layers: Cut (magenta) · Art · Bleed
//   (black offset). Show layer panel like Illustrator.
// - Right inspector:
//     - WPW spec compliance checklist (read concept_json.wpw_spec):
//         ✓ Spot color named 'CutContour'
//         ✓ CMYK 0/100/0/0
//         ✓ 0.25pt hairline stroke
//         ✓ Three layers in correct order
//         ✓ Black bleed at <bleed_inches>"
//       Red ✗ for anything missing.
//     - review_flags surfaced as actionable rows (jump-to-zone
//       button next to each).
//     - Per-layer panel from concept_json.layers: label, copy,
//       dims, film. Click a layer → highlights its cut path on
//       the canvas.
//     - Approve / Send back for revision buttons at the bottom.
//
// On approve:
//   panelizer_jobs.update({ status: 'qc_approved', qc_notes,
//                           qc_approved_by, qc_approved_at }).
//   Optional: kick package-production-files to emit the final
//   PDF (CMYK + real spot color) — separate fn call, not blocking.
//
// On send back:
//   panelizer_jobs.update({ status: 'needs_revision',
//                           qc_notes }) and notify customer.
```

### 2. Route + admin link

```tsx
// src/App.tsx
const QCCutContour = lazyWithRetry(() => import("./pages/QCCutContour"));
// ...
<Route path="/qc-cutcontour" element={<RequireAdmin><QCCutContour /></RequireAdmin>} />
```

Add a link inside `QcJobsRail` that routes studio jobs to
`/qc-cutcontour` and vehicle/wall/glass jobs to `/qc-artboard`.

### 3. Backend (optional, defer if time-pressed)

`supabase/functions/qc-cutcontour-validate/index.ts` — server-side
re-check of the WPW spec on the actual SVG (parse path styles,
verify stroke weight, count layers, measure bleed offset). Returns
the same shape the inspector renders. Frontend can call it on page
load to refresh compliance.

### 4. package-production-files PDF emitter

Real WPW-compliant PDF (not SVG): CMYK color space, true
`CutContour` spot in the PDF color resources dict, three OCG layers.
This is the deliverable WPW's plotter needs. The QC page calls this
on approve.

## File-touch budget for next session

| File | Action | Approx. lines |
|---|---|---|
| `src/pages/QCCutContour.tsx` | NEW | ~600 (small fraction of QCArtboard) |
| `src/App.tsx` | edit | 2 |
| `src/components/proof/QcJobsRail.tsx` | edit | ~20 (route studio → new page) |
| `supabase/functions/qc-cutcontour-validate/index.ts` | NEW (optional) | ~150 |
| `supabase/functions/package-production-files/index.ts` | edit | ~80 (add studio branch) |

## Things to NOT touch

- `src/pages/QCArtboard.tsx` — leave the DesignPro flow alone.
- The locked render-pipeline files listed in `CLAUDE.md`.
- `panelizer_jobs` schema — everything fits in existing columns
  (`status`, `cut_path_svg_url`, `concept_json` jsonb). No new
  table needed.

## End-state demo

After next session a working flow looks like:

1. Customer opens GraphicsPro Studio, draws 3 zones, types copy
2. Generate Mockup → AI render
3. Generate Cut Contour Pack → vectorize-it → SVG
4. Job lands in panelizer_jobs with `status: 'needs_qc_review'`
5. Admin opens `/qc-cutcontour` → sees the job in the left rail
6. Inspects the SVG on the artboard, sees ✓ ✓ ✗ on the WPW
   compliance checklist (e.g. ✗ stroke too thick)
7. Approves OR sends back with notes
8. On approve → `package-production-files` emits the WPW-compliant
   PDF → customer downloads from ProductionFlow
