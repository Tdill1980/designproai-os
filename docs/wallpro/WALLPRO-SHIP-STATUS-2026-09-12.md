# WallPro — what is actually done, 2026-09-12

Written for a ship decision tonight. Three evidence levels, and they are not
interchangeable (same convention CLAUDE.md's own status board uses):

| level | means |
|---|---|
| **DEPLOYED-VERIFIED** | merged, deployed, and read back off the live system this session |
| **MERGED** | merged to main and CI-green; deploy not yet confirmed by reading it back |
| **NOT BUILT** | does not exist. No partial credit. |

Nothing below is marked done because a test passed. Tests prove the code does
what it says; they do not prove a customer can buy anything.

---

## 1. Shipped and verified live today

| # | What | Evidence |
|---|---|---|
| 1 | **`wpw-oauth-link`** — links a DesignProAI account to its WePrintWraps WooCommerce customer by email, with OTP verification for a cross-domain address | DEPLOYED-VERIFIED: `ACTIVE` v1 on project `wozyamlnygaddievzuwn`, source read back and matched (PR #388) |
| 2 | **WallPro paid entitlements** — `wallpro_purchase_entitlements`, `confirm_wallpro_purchase` (idempotent on checkout session), gateway `POST /api/wallpro/checkout/sessions`, Stripe webhook branch, runtime confirm endpoint. `request_wallpro_production` now **raises** without a paid entitlement, so production export is gated **in the database**, not just in the UI | MERGED + dark deploy success (PR #389) |
| 3 | **Creative contract** — consultant compiles a typed Design Contract (required subjects/elements/colours immutable), designer reframed to commercial environmental/wrap designer, consultant temp 0.9 → 0.15, advisory compliance check on the finished image | DEPLOYED-VERIFIED: `generate-wall-design` v40 live, persona + `checkWallCompliance` + temp 0.15 read back (PR #390) |
| 4 | **Occlusion** — customer masks now actually reach the AI view, and protected pixels are **restored deterministically after generation** (a guarantee, not a prompt). Objects auto-classified `fixed` (window/TV/mirror/mantel → protected) vs `movable` (furniture/equipment → painted through). Removal is verified by a cheap vision check and retried once | DEPLOYED-VERIFIED: `render-wall-view` v24 and `detect-wall-openings` v28 live, `verifyRemoval` / `applyProtectedAreaMask` / classification read back (PR #391) |
| 5 | **Accent zones** — wrap two areas of one photo (mural on the wall, brick on the fireplace). Each zone its own corners, its own inches, its own design, its own print files, its own purchase. Both render together in one on-wall picture | MERGED, CI green; dark deploy in flight at time of writing (PR #392) |

**Deploy note:** edge functions ship on a *separate* dispatch from the droplet
dark deploy. Both were dispatched and confirmed today for 1, 3 and 4. Item 5 is
frontend-only, so it needs the dark deploy only.

---

## 2. Built but NOT proven with real money

> **This is the only thing standing between "deployed" and "shippable".**

The paid path has never been run end to end by a human. Specifically unproven:

- [ ] A real Stripe checkout completes on `wallpro_custom_file` ($149)
- [ ] The webhook writes an entitlement row idempotently
- [ ] `request_wallpro_production` then **allows** the job it currently refuses
- [ ] Panels build at 150 PPI through Topaz
- [ ] A file is downloaded and **opened**: dimensions, bleed, resolution, artwork continuity
- [ ] Seam/panel logic correct where it applies; TIFF, PDF and PNG all present

Until that checklist is ticked, "WallPro is live" means the code is deployed —
not that anyone has successfully bought anything.

**Sharper test available:** three real past WePrintWraps wall-wrap design
orders exist in the order history at ~$975 each. Running those same briefs
through WallPro and comparing to what the designer actually delivered is a far
better quality bar than a synthetic test, and it directly tests the margin
thesis (can software serve work that currently costs designer hours).

---

## 3. Pricing: declared vs wired

All four SKUs exist in the schema and the gateway price table. **Only one has a
button.**

| SKU | Price | State |
|---|---|---|
| `wallpro_custom_file` | $149 | **Wired** — the only purchasable path |
| `wallpro_catalog_file` | $79 | Declared, no UI |
| `wallpro_room_design_file` | $199 | Declared, no UI |
| `wallpro_file_prep` | $49 | Declared, no UI |

Adding any of the other three is a frontend change only — the schema and the
gateway already know them. No print credit is hard-coded anywhere, by decision.

---

## 4. NOT BUILT

Listed so nothing here is mistaken for done.

- **WPW order sync.** `wpw-oauth-link` provides the join key (DesignProAI user →
  Woo customer id) and `_shared/woo-client.ts` can already read orders and their
  UTM/gclid/fbclid attribution — but there is **no `wpw_orders` table and no
  sync**. Consequence: you can see who signed up, not who is a repeat $975
  buyer. That cohort is invisible until this lands. *(Next up.)*
- **WrapReadyDesigns integration.** Different repo (`restylepro-os`), different
  Supabase project (`kfapjdyythzyvnpdeghu`). It cannot sell WallPro designs
  today. Partner ads pointing there land on a site without the product.
- **Trade version** — white-label client presentation, client-shareable link,
  credit packs / seats.
- **Design-only tier** — visualization without print files, incl. bring-your-own
  covering. Note: uploading someone else's covering already works
  (`designMode: 'upload'`) and production is already entitlement-gated, so this
  is mostly a pricing/packaging build, not a pipeline build.
- **GENIE progress UI for WallPro** — plan written
  (`WALLPRO-GENIE-UI-INTEGRATION-PLAN.md`), no code.

---

## 5. Known limits, stated honestly

- **Removal is best-effort; protection is a guarantee.** Protected pixels are
  restored by code and cannot fail. Erasing a movable object is generative —
  verified and retried once, then accepted as-is with `removal_verified`
  reported false rather than silently claimed. A misclassification is
  correctable with the manual mask tools, which are all still there.
- **Combined zone preview** draws a sibling zone from its stored master without
  re-applying that zone's seam-mirror setting. Preview fidelity only; each
  zone's own view and its print files are unaffected.
- **`temperature: 0.7`** on the image call is unmeasured — no A/B proves it
  beats the provider default on this endpoint. Watch real output before
  treating it as settled.
