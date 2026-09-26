# DesignPro design archive

Migration: `supabase/migrations/20260926010000_designpro_design_archive.sql`
Proof: `tests/designpro-design-archive-db.test.mjs` (PGlite, RLS on) and
`supabase/tests/designpro_archive.test.sql` (pgTAP, full migration chain in CI).

## What it is

An **index**, not a second copy. The generation tables stay the source of truth;
the archive adds one row per design and a link to its orders, and reads files and
prompts through views over the existing tables.

| Object | Purpose |
| --- | --- |
| `designpro_designs` | One row per design. `design_id` = `DID-` + first 8 hex of the GenerationID (the same DesignID `gateway/src/server.mjs:237`, `runtime/generation-worker.cjs:395` and `runtime/wrapbox-delivery.cjs:159` already mint; 32 bits, so a collision is possible in principle and would leave that design unindexed with a WARNING rather than fail the request). Customer/company, vehicle year/make/model/type, status, current request and revision, `created_year` (Phoenix time), full-text `search_text`, `template_ref` (future vector template hook). |
| `designpro_design_orders` | Design ↔ order. `source` = woocommerce / stripe / intake / manual; normalized `order_number` (leading `#` removed); optional `woo_order_id`. |
| `designpro_design_files` (view) | Every file of a design: per-view renders, revision master/projection/manifest/guide, pipeline artifacts (panels, proofs, zips). |
| `designpro_design_prompts` (view) | Every prompt: original brief, each revision instruction, each per-view regeneration note. |
| `designpro_design_search(...)` | Library search: free text, order #, make, model, vehicle year, created year, date range, status; keyset pagination. SECURITY INVOKER, so RLS decides what each caller sees. |
| `designpro_design_history(design_id)` | Versions + prompts + files + orders in order (`designpro.design-history.v1`). Owner or QC staff only (existing `caller_may_read_generation`). This is what Revision Studio and PanelPro read. |
| `designpro_bind_design_order(gen, order, source, woo_id)` | Customers may record their own `intake` order number; `woocommerce`/`stripe`/`manual` bindings are staff/service facts. |
| `designpro_archive_backfill(limit, dry_run)` | Service-role only. Indexes existing generations; reports free-text order candidates without binding them. |

## Automatic

Triggers (all exception-safe: an archive failure logs a WARNING and never fails
the customer's write):

- a generation request is inserted or changes state → design row upserted (revisions share the GenerationID, so they update the same design);
- an atlas revision is inserted → design's current revision;
- a non-intake order is bound → status `ordered` (never downgraded by later generation states). An intake order number is a reference the customer typed, not a purchase.

## Access

- Customers see only their own designs; QC staff (`designpro_qc_members.can_preflight`) see all.
- Nobody writes the tables directly. Anonymous callers cannot read.
- The two views are service-only because production grants `authenticated` no SELECT on `designpro_generation_requests`, `_views` or `_slots` (checked 2026-09-25); customers read them through `designpro_design_history`.

## Backfill (production, owner-run)

Production on 2026-09-25 (read-only SQL): 248 requests, 248 GenerationIDs, 18 owners, 122 atlas revisions, 0 revision requests. 247 requests carry a 4-digit vehicle year, 248 a make.
11 requests carry an `orderNumber` input; all 11 are test values (`CANARY-…`, `LIVE-…`, `ATLAS-FIX-…`, `SEAM-VERIFY-001`) and will be bound as `intake`.
5 requests have a `#NNNN` in the design name; they are **reported only**.

```
# after the migration is applied, on the droplet:
node scripts/designpro-archive-backfill.mjs          # dry run
node scripts/designpro-archive-backfill.mjs --apply  # index
```

To bind a confirmed free-text order as staff: `select designpro_bind_design_order('<generation uuid>', '30292', 'woocommerce', 30292);`

## Not in this PR

- Library search UI, order # field at intake, full version history in Revision Studio / PanelPro: the archive UI PR (flag `VITE_DESIGNPRO_ARCHIVE_V1`).
- Automatic Woo/Stripe binding from `wpw-sync-orders` / the Stripe webhook: needs a design reference on the Woo order (not present today; `wpw_orders` has no design or user column).
