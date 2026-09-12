# WallPro × GENIE UI Integration — Safe Plan (not yet built)

**Status: PLAN ONLY.** Nothing in this document has been implemented. This is
the spec to hand to a coding session when it's time to build it — see
"When to build this" below for the recommended sequencing.

## The ask

WallPro should get GENIE's "Universal Panelizer" look and feel — the
progress rail, the glowing stages, the sense of a real production system at
work — without touching GENIE's own page, without exposing vehicle logic to
WallPro, and without exposing production files to a customer who is just
watching a progress bar.

## The rule that makes this safe

**GENIE stays a canonical engine. Borrow the UI, never duplicate the
product.** Concretely:

- The existing GENIE Universal Panelizer page (`pages/designpro/GenieProgress.tsx`
  and whatever it renders) is **not touched**. Its vehicle geometry, its
  PanelPro state, its own data fetching — all untouched, all still vehicle-only.
- Nothing about WallPro's design or job state moves into GENIE's schema,
  RPCs, or React state. WallPro keeps owning its own data end to end.
- The only thing that crosses the line is a **UI shell**: the visual
  component that draws stages, glow states and progress — extracted so it
  accepts a neutral, medium-agnostic job-status object instead of reading
  vehicle-specific fields directly.

## What gets built (when the time comes)

1. **Extract the shell, change nothing about its behavior.**
   Pull the presentational piece of GENIE's progress UI (the stage rail,
   the glow animation, the layout) into its own component that takes a
   prop shape like:

   ```ts
   type ProductionStageStatus = {
     key: string;            // e.g. "panel-1", "topaz", "manifest"
     label: string;          // human label for the stage
     state: 'pending' | 'running' | 'ready' | 'failed';
     detail?: string;        // optional short status text
   };
   type ProductionJobStatus = {
     stages: ProductionStageStatus[];
     overallState: 'queued' | 'running' | 'ready' | 'failed';
   };
   ```

   GENIE's own page keeps building this shape from vehicle panel/QC data,
   exactly as it does today — this is a refactor of *how it's rendered*,
   not *what it knows*.

2. **WallPro builds the same neutral shape from its own data.**
   `wallpro_production_jobs.progress` / `.panels` (already the real,
   existing job-status data WallPro's production runtime writes) gets
   mapped to the same `ProductionJobStatus` shape. No new backend work —
   this is a pure frontend adapter over data that already exists.

3. **Mount the shared shell inside a new WallPro route**, fed by that
   adapter, labeled "Powered by GENIE." WallPro's own page (`WallPro.tsx`
   or a new `WallProProgress.tsx`) owns the route, the job polling and the
   customer-facing copy; the shell only draws what it's handed.

4. **No file exposure.** The shell shows stage state, not file contents or
   paths — a customer watching their wall render sees a real production
   system working, never a link to an unpurchased file. This is naturally
   already true of the existing entitlement gate: production files are
   walled off from unpaid customers before this UI ever renders.

## What this deliberately does NOT do

- Does not give WallPro any vehicle geometry, PanelPro state, or GENIE
  RPC access.
- Does not change GENIE's page, GENIE's data model, or GENIE's tests.
- Does not require WallPro and vehicle jobs to share a table, a component
  state shape, or a route.
- Does not ship any files or previews the customer hasn't paid for.

## When to add this safely

**Not now.** Recommended order:

1. **Run the WallPro purchase acceptance test first** (already scheduled,
   not yet done): one real Stripe checkout → confirmed entitlement →
   unlocked production export → a real downloaded file, physically
   inspected for dimensions, bleed, 150 PPI, and artwork continuity. There
   is no point dressing up a progress bar for a pipeline that hasn't been
   proven end to end with real money and a real file yet.

2. **Land the creative-contract rework** (`generate-wall-design/prompt.ts`
   and `handler.ts` — the typed Design Contract, the persona reframe, the
   temperature split; tracked separately, in progress alongside this plan).
   This is the part that decides whether WallPro is actually producing
   designs worth showing off. A polished "Powered by GENIE" progress
   screen around a mediocre design doesn't help anyone — fix the design
   quality before investing in the presentation of making it.

3. **Then** extract the GENIE shell and wire WallPro into it. By this
   point WallPro has a proven purchase path and a stronger design engine,
   so the GENIE-styled progress view is dressing up something that
   actually works, not covering for something that doesn't yet.

This is a small, low-risk, purely additive UI project once 1 and 2 are
done — it never touches GENIE's own page or data, so it carries no
regression risk to the vehicle product regardless of when it ships. The
sequencing above is about not spending effort on presentation before the
substance underneath it is proven, not about technical risk.
