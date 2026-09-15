# PatternPro on DesignProAI — end to end (2026-09-15)

PatternPro is Wrap-By-The-Yard: pick one of the 118 real WePrintWraps
patterns, see it on any vehicle in 3D, get the yards a full wrap takes, and
buy the printed film. It was ported here from the suite it was born in on
2026-09-15 (owner: "all these need to be in os.designpro repo"), in two PRs:
#414 (the page, the library, the render functions) and #418 (the paid path,
ShopFlow tracking, the admin pages). This file is what the next session needs
to know; the tests named below are the contract.

## The surfaces

| Route | What | Brand |
|---|---|---|
| `/pattern-wrap` | The WePrintWraps page: white, blue gradient, WPW mark × PatternPro in the WallPro lockup, no DesignProAI chrome (`isWallProPartnerRoute`) | `weprintwraps` |
| `/printpro/patternpro` | The same tool under the DesignProAI name | `designpro` |
| `/wbty` | Old address → redirects to `/printpro/patternpro` | |
| `/wbty/order-success` | Stripe's return page; "Track this order in ShopFlow" with the `PP-` reference pre-filled | |
| `/shopflow` | PatternPro orders appear as `PP-XXXXXXXX` beside Woo orders; "Order more yards" → `/pattern-wrap` | |
| `/admin/wbty-manager` | The 118-pattern library (names, swatches, collections, pricing, active) | admin |
| `/admin/wbty-orders` | Every Stripe-paid order: status, tracking, the print order | admin |

One component (`app/src/pages/PatternWrap.tsx`) worn by a brand
(`app/src/lib/patternpro-brand.ts`), WallPro's shape. The tool itself is
`WBTYToolUI` + `useWBTYLogic`, kept in step with the source suite's versions.

## The data

- `wbty_products` — 118 active rows, five collections. `category` is the
  string that resolves the WooCommerce product for the cart link
  (`WPW_WOOCOMMERCE_IDS` in `app/src/data/patternpro-patterns.ts`); it must
  match exactly. Swatch images stay on the source project's public bucket
  (`…/wrap-files/pattern-swatches-wpw/<collection>/<slug>.jpg`) — the one
  curated copy. Seeded by `20260915090000_patternpro_wbty_products.sql`.
- `wbty_carousel` — same shape as the source; empty.
- `wbty_orders` — the paid path's row; status CHECK matches the ShopFlow stage
  table (`app/src/lib/shopflowStages.ts` ↔ `_shared/shopflow-stages.ts`, add
  a status to all three together). `20260915230000_patternpro_wbty_orders.sql`.
- Bucket `patternpro-files` (PUBLIC) — the on-vehicle renders. `wrap-files`
  is PRIVATE on this project, so the render function writes here
  (`RENDER_BUCKET` in `generate-pattern-render`).

## The functions

| Function | Called by | Secrets |
|---|---|---|
| `generate-pattern-render` | the tool (Gemini, one call per view, 7 views) | `GOOGLE_AI_API_KEY` |
| `calculate-film-yards` | the tool, on year+make+model | `GOOGLE_AI_API_KEY` |
| `create-wbty-checkout` | Buy modal → inserts a `pending` row, opens Stripe Checkout | `STRIPE_SECRET_KEY` |
| `wbty-stripe-webhook` | Stripe → `paid` + address, then the print order → `fulfillment_emailed` | `STRIPE_WBTY_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY` |
| `send-wbty-order-email` | the webhook → print order to `WPW_FULFILLMENT_EMAIL`, confirmation to the buyer | `RESEND_API_KEY`, `ORDER_FROM_EMAIL` |
| `wpw-shopflow` / `wpw-orders-read` | ShopFlow (#416) — merge `wbty_orders` rows in as PatternPro orders | |

Checkout sends the buyer back to the host they started on: an allowlisted
request Origin (`os.designproai.com`, `wallpro.weprintwraps.com`) wins,
`PUBLIC_SITE_URL` is the fallback. A WePrintWraps customer must never land on
a DesignProAI page mid-purchase.

## Secrets — what is set and what is not (2026-09-15)

`deploy-edge-functions.yml` sets the function secrets from repo secrets on
every dispatch; a missing one warns and the function fails closed.

| Repo secret | State on 2026-09-15 |
|---|---|
| `DESIGNPRO_GOOGLE_AI_API_KEY` | set; renders and yardage work (live-tested) |
| `DESIGNPRO_STRIPE_SECRET_KEY` | set but **rejected by Stripe** ("Invalid API Key provided: sk_live_…jqn7"). The same secret feeds the gateway's production-pack checkout. Replace, then re-dispatch the edge deploy. |
| `DESIGNPRO_STRIPE_WBTY_WEBHOOK_SECRET` | **not set.** Create a Stripe webhook endpoint for `https://wozyamlnygaddievzuwn.supabase.co/functions/v1/wbty-stripe-webhook` (events `checkout.session.completed`, `checkout.session.expired`, `charge.refunded`) and store its signing secret. Until then every Stripe event is refused as unsigned and no order leaves `pending`. |
| `DESIGNPRO_RESEND_API_KEY` | **not set.** `ORDER_FROM_EMAIL` (default `orders@designproai.com`) must be on a Resend-verified domain. The webhook logs a failed send and the order still lands as `paid` on the admin board. |

## Deploying — the three gotchas that cost time today

1. **The edge deploy is dispatch-only.** Merging ships nothing.
   `deploy-edge-functions.yml` with `confirmation=DEPLOY_DESIGNPRO_FUNCTIONS`
   and `functions=<comma list>`. Verify by reading the deployed body back
   (`get_edge_function`) and grepping for a string you added.
2. **The frontend deploys from main's HEAD only.** A dispatch of
   `deploy-production.yml` requires `exact_sha` == the ref's head. The
   automatic path fires after a green push gate when the HEAD commit message
   contains `[dark-deploy]` (a substring grep — see PR #325's note). If another
   PR merges behind yours, your gate run is cancelled (concurrency) and your
   SHA can no longer be dispatched; either re-run your gate once main is quiet
   (the automatic path then deploys your exact SHA) or deploy the new head.
   **Do not re-run an old SHA's gate after a newer head has been deployed** —
   the automatic path would roll the droplet back. Cancel it if it fires.
3. **Migrations apply by hand** (`apply_migration` through MCP, or the
   protected release dispatch) — also not on merge. Every appended migration
   widens two assertions by one: `tests/supabase-bootstrap.test.mjs` (count +
   stamp) and `tests/schema-gateway-reconcile.test.mjs` (window + filename).
   Forgetting them turns main red for everyone (#416 → #417).

Also: `source-tests/schema/schema-closure` forbids the source suite's name
anywhere in a migration, comments included; `supabase/tests/designpro_bootstrap`
allowlists every `storage.objects` policy by name.

## Known product truth

The 3D proof is Gemini's reading of the swatch under studio light and can
drift warm (Chameleon Camo Tan's side views came out golden; the swatch is
taupe-on-beige). The swatch is the print truth. Not fixed; candidates are a
"colour proof is approximate" line on the page and a colour-lock line in the
render prompt, which needs a test render before it ships.

## Tests

`tests/pattern-wrap-page.test.mjs`, `tests/patternpro-buy-path.test.mjs`, and
the migration-chain assertions above.
